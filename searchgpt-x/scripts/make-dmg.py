#!/usr/bin/env python3
"""Build a macOS .dmg (UDIF, zlib-compressed, HFS+ volume) without macOS tools.

On a Mac you would just run `hdiutil create`. This script exists so the
installer can be produced on Linux CI as well. It:

  1. writes an HFS+ (case-insensitive, non-journaled) volume image containing
     the staged folder, preserving symlinks and Unix permissions, then
  2. wraps that image in a UDIF "UDZO" container (zlib chunks + koly trailer).

Usage: make-dmg.py <staging-folder> <volume-name> <out.dmg> [--raw out.img]

References: Apple TN1150 (HFS Plus Volume Format) and the UDIF layout used by
hdiutil / libdmg-hfsplus.
"""

import base64
import os
import stat
import struct
import sys
import time
import uuid
import zlib

BLOCK = 4096
NODE = 4096
SECTOR = 512
HFS_EPOCH = 2082844800  # seconds between 1904-01-01 and 1970-01-01

ROOT_PARENT_ID = 1
ROOT_FOLDER_ID = 2
EXTENTS_FILE_ID = 3
CATALOG_FILE_ID = 4
FIRST_USER_ID = 16

REC_FOLDER, REC_FILE, REC_FOLDER_THREAD, REC_FILE_THREAD = 1, 2, 3, 4


def hfs_time(t=None):
    return int((time.time() if t is None else t) + HFS_EPOCH) & 0xFFFFFFFF


# ----------------------------------------------------------------------------- tree


class Node:
    def __init__(self, path, name, parent):
        self.path = path
        self.name = name
        self.parent = parent
        self.st = os.lstat(path)
        self.is_dir = stat.S_ISDIR(self.st.st_mode)
        self.is_link = stat.S_ISLNK(self.st.st_mode)
        self.children = []
        self.cnid = 0
        self.data = None  # symlink target bytes
        self.size = 0
        self.start_block = 0
        self.blocks = 0
        if self.is_link:
            self.data = os.readlink(path).encode('utf-8')
            self.size = len(self.data)
        elif not self.is_dir:
            self.size = self.st.st_size


def fold(name):
    # HFS+ case-insensitive order. Exact for ASCII names (all we allow).
    return name.lower()


def hfs_name(name):
    if any(ord(c) > 0x7E or ord(c) < 0x20 for c in name):
        raise SystemExit(f'Non-ASCII file name not supported by this builder: {name!r}')
    return name.replace(':', '/')  # HFS+ stores "/" as ":" and vice versa


def build_tree(root_path):
    root = Node(root_path, '', None)
    queue = [root]
    nodes = [root]
    next_id = FIRST_USER_ID
    root.cnid = ROOT_FOLDER_ID
    while queue:
        d = queue.pop(0)
        names = sorted(os.listdir(d.path))
        seen = set()
        for n in names:
            if n in ('.DS_Store',):
                continue
            c = Node(os.path.join(d.path, n), hfs_name(n), d)
            if fold(c.name) in seen:
                raise SystemExit(f'Names differ only by case: {c.path}')
            seen.add(fold(c.name))
            c.cnid = next_id
            next_id += 1
            d.children.append(c)
            nodes.append(c)
            if c.is_dir:
                queue.append(c)
    return root, nodes, next_id


# ----------------------------------------------------------------------------- B-tree helpers


def uni(name):
    enc = name.encode('utf-16-be')
    return struct.pack('>H', len(enc) // 2) + enc


def cat_key(parent_id, name):
    body = struct.pack('>I', parent_id) + uni(name)
    return struct.pack('>H', len(body)) + body


def sort_key(parent_id, name):
    return (parent_id, fold(name))


def bsd_info(mode, is_dir):
    # ownerID, groupID, adminFlags, ownerFlags, fileMode, special
    return struct.pack('>IIBBHI', 0, 80, 0, 0, mode & 0xFFFF, 0)


def fork_data(size, start, count):
    ext = struct.pack('>II', start, count) if count else struct.pack('>II', 0, 0)
    ext += b'\0' * 56
    return struct.pack('>QII', size, 0, count) + ext


def folder_record(n, now):
    mode = (n.st.st_mode & 0o7777) | stat.S_IFDIR
    rec = struct.pack('>hHII', REC_FOLDER, 0, len(n.children), n.cnid)
    rec += struct.pack('>IIIII', now, now, now, now, 0)
    rec += bsd_info(mode, True)
    rec += b'\0' * 16  # FolderInfo (Finder window info)
    rec += b'\0' * 16  # ExtendedFolderInfo
    rec += struct.pack('>II', 0, 0)
    assert len(rec) == 88
    return rec


def file_record(n, now):
    if n.is_link:
        mode = stat.S_IFLNK | 0o755
        finfo = b'slnk' + b'rhap' + struct.pack('>HhhH', 0, 0, 0, 0)
    else:
        mode = stat.S_IFREG | (n.st.st_mode & 0o7777)
        finfo = b'\0' * 16
    rec = struct.pack('>hHII', REC_FILE, 0x0002, 0, n.cnid)  # kHFSThreadExistsMask
    rec += struct.pack('>IIIII', now, now, now, now, 0)
    rec += bsd_info(mode, False)
    rec += finfo
    rec += b'\0' * 16  # ExtendedFileInfo
    rec += struct.pack('>II', 0, 0)
    rec += fork_data(n.size, n.start_block, n.blocks)
    rec += fork_data(0, 0, 0)
    assert len(rec) == 248
    return rec


def thread_record(kind, parent_id, name):
    return struct.pack('>hhI', kind, 0, parent_id) + uni(name)


def make_node(kind, height, records, flink=0, blink=0):
    """records: list of bytes. Returns a NODE-sized buffer."""
    buf = bytearray(NODE)
    struct.pack_into('>IIbBHH', buf, 0, flink, blink, kind, height, len(records), 0)
    off = 14
    offsets = []
    for r in records:
        offsets.append(off)
        buf[off:off + len(r)] = r
        off += len(r)
    offsets.append(off)  # free space offset
    for i, o in enumerate(offsets):
        struct.pack_into('>H', buf, NODE - 2 * (i + 1), o)
    assert off <= NODE - 2 * len(offsets), 'node overflow'
    return buf


def pack_level(items):
    """Greedily pack (sortkey, recordbytes, firstkeybytes) items into nodes."""
    nodes, cur, used = [], [], 14
    for it in items:
        need = len(it[1]) + 2
        if cur and used + need + 2 > NODE:
            nodes.append(cur)
            cur, used = [], 14
        cur.append(it)
        used += need
    if cur:
        nodes.append(cur)
    return nodes


def header_node(depth, root, leaf_records, first_leaf, last_leaf, total, free, max_key, attrs, compare, used_nodes, clump):
    hdr = struct.pack('>HIIIIHHIIHIBBI', depth, root, leaf_records, first_leaf, last_leaf, NODE, max_key, total, free, 0, clump, 0, compare, attrs)
    hdr += b'\0' * 64
    assert len(hdr) == 106
    user = b'\0' * 128
    map_len = NODE - 14 - 106 - 128 - 8
    bitmap = bytearray(map_len)
    if used_nodes > map_len * 8:
        raise SystemExit('B-tree too large for a single map record')
    for i in range(used_nodes):
        bitmap[i // 8] |= 0x80 >> (i % 8)
    return make_node(1, 0, [hdr, user, bytes(bitmap)])


def build_catalog(root, nodes, volname, now):
    entries = []  # (sortkey, keybytes, data)
    for n in nodes:
        name = volname if n is root else n.name
        parent = ROOT_PARENT_ID if n is root else n.parent.cnid
        if n.is_dir:
            entries.append((sort_key(parent, name), cat_key(parent, name), folder_record(n, now)))
            entries.append((sort_key(n.cnid, ''), cat_key(n.cnid, ''), thread_record(REC_FOLDER_THREAD, parent, name)))
        else:
            entries.append((sort_key(parent, name), cat_key(parent, name), file_record(n, now)))
            entries.append((sort_key(n.cnid, ''), cat_key(n.cnid, ''), thread_record(REC_FILE_THREAD, parent, name)))
    entries.sort(key=lambda e: e[0])
    for a, b in zip(entries, entries[1:]):
        assert a[0] != b[0], f'duplicate catalog key {a[0]}'

    # Leaves start at node 1 (node 0 is the header).
    leaf_groups = pack_level([(e[0], e[1] + e[2], e[1]) for e in entries])
    levels = [leaf_groups]
    while len(levels[-1]) > 1:
        # Index records: the child's first key + child node number (filled later).
        prev = levels[-1]
        idx_items = [(g[0][0], g[0][2] + b'\0\0\0\0', g[0][2]) for g in prev]
        levels.append(pack_level(idx_items))

    # Number nodes: header 0, then leaves, then each index level upwards.
    numbering = []
    nxt = 1
    for lvl in levels:
        numbering.append(list(range(nxt, nxt + len(lvl))))
        nxt += len(lvl)
    total_used = nxt
    total_nodes = max(total_used, 8)
    out = {}
    for li, lvl in enumerate(levels):
        nums = numbering[li]
        for gi, group in enumerate(lvl):
            recs = []
            for ri, it in enumerate(group):
                if li == 0:
                    recs.append(it[1])
                else:
                    # pointer to the child node this record indexes
                    child_index = sum(len(g) for g in lvl[:gi]) + ri
                    recs.append(it[2] + struct.pack('>I', numbering[li - 1][child_index]))
            flink = nums[gi + 1] if gi + 1 < len(nums) else 0
            blink = nums[gi - 1] if gi > 0 else 0
            kind = -1 if li == 0 else 0
            out[nums[gi]] = make_node(kind, li + 1, recs, flink, blink)
    depth = len(levels)
    root_node = numbering[-1][0]
    hdr = header_node(depth, root_node, len(entries), numbering[0][0], numbering[0][-1], total_nodes, total_nodes - total_used,
                      516, 0x6, 0xCF, total_used, NODE)
    data = bytearray(total_nodes * NODE)
    data[0:NODE] = hdr
    for num, buf in out.items():
        data[num * NODE:(num + 1) * NODE] = buf
    return bytes(data)


def build_extents_tree():
    nodes = 1
    hdr = header_node(0, 0, 0, 0, 0, nodes, 0, 10, 0x2, 0, 1, NODE)
    return bytes(hdr)


# ----------------------------------------------------------------------------- volume


def build_hfs(staging, volname, out_path):
    root, nodes, next_id = build_tree(staging)
    now = hfs_time()
    files = [n for n in nodes if not n.is_dir]
    data_blocks = sum((n.size + BLOCK - 1) // BLOCK for n in files)

    extents = build_extents_tree()
    # Catalog size doesn't depend on block numbers (fixed-size records), so
    # build once to measure, then again after allocation.
    cat_len = len(build_catalog(root, nodes, volname, now))
    cat_blocks = (cat_len + BLOCK - 1) // BLOCK
    ext_blocks = (len(extents) + BLOCK - 1) // BLOCK

    slack = max(256, (data_blocks // 50))  # ~2% free space
    total = 1 + ext_blocks + cat_blocks + data_blocks + slack + 1
    while True:
        bitmap_blocks = (((total + 7) // 8) + BLOCK - 1) // BLOCK
        need = 1 + bitmap_blocks + ext_blocks + cat_blocks + data_blocks + slack + 1
        if need <= total:
            break
        total = need

    cursor = 1
    bitmap_start, cursor = cursor, cursor + bitmap_blocks
    ext_start, cursor = cursor, cursor + ext_blocks
    cat_start, cursor = cursor, cursor + cat_blocks
    for n in files:
        n.blocks = (n.size + BLOCK - 1) // BLOCK
        n.start_block = cursor if n.blocks else 0
        cursor += n.blocks
    used = cursor + 1  # +1 for the last block (alternate volume header)
    free = total - used

    catalog = build_catalog(root, nodes, volname, now)
    assert len(catalog) == cat_len

    bitmap = bytearray(bitmap_blocks * BLOCK)
    def mark(b):
        bitmap[b // 8] |= 0x80 >> (b % 8)
    for b in range(cursor):
        mark(b)
    mark(total - 1)

    file_count = len(files)
    folder_count = sum(1 for n in nodes if n.is_dir) - 1

    def fork(size, start, blocks):
        return struct.pack('>QII', size, BLOCK * blocks, blocks) + struct.pack('>II', start, blocks) + b'\0' * 56

    vh = struct.pack('>HHIII', 0x482B, 4, 0x00000100, 0x31302E30, 0)  # 'H+', v4, unmounted, '10.0'
    vh += struct.pack('>IIII', now, now, 0, now)
    vh += struct.pack('>II', file_count, folder_count)
    vh += struct.pack('>IIII', BLOCK, total, free, cursor)
    vh += struct.pack('>III', 65536, 65536, next_id)
    vh += struct.pack('>IQ', 1, 1)
    vol_uuid = uuid.uuid4().bytes[:8]
    vh += struct.pack('>IIIIII', 0, 0, 0, 0, 0, 0) + vol_uuid
    vh += fork(len(bitmap), bitmap_start, bitmap_blocks)
    vh += fork(len(extents), ext_start, ext_blocks)
    vh += fork(len(catalog), cat_start, cat_blocks)
    vh += b'\0' * 80  # attributes file (none)
    vh += b'\0' * 80  # startup file (none)
    assert len(vh) == 512, len(vh)

    size = total * BLOCK
    with open(out_path, 'wb') as f:
        f.truncate(size)
        f.seek(1024)
        f.write(vh)
        f.seek(bitmap_start * BLOCK)
        f.write(bitmap)
        f.seek(ext_start * BLOCK)
        f.write(extents)
        f.seek(cat_start * BLOCK)
        f.write(catalog)
        for n in files:
            if not n.blocks:
                continue
            f.seek(n.start_block * BLOCK)
            if n.is_link:
                f.write(n.data)
            else:
                with open(n.path, 'rb') as src:
                    while True:
                        chunk = src.read(1 << 20)
                        if not chunk:
                            break
                        f.write(chunk)
        f.seek(size - 1024)
        f.write(vh)
    return size, file_count, folder_count


# ----------------------------------------------------------------------------- UDIF


CHUNK_SECTORS = 0x200


def build_udif(raw_path, out_path, level=9):
    raw_size = os.path.getsize(raw_path)
    assert raw_size % SECTOR == 0
    sectors = raw_size // SECTOR
    runs = []
    data_crc = 0
    part_crc = 0
    offset = 0
    with open(raw_path, 'rb') as src, open(out_path, 'wb') as out:
        sector = 0
        while sector < sectors:
            n = min(CHUNK_SECTORS, sectors - sector)
            chunk = src.read(n * SECTOR)
            part_crc = zlib.crc32(chunk, part_crc)
            if chunk.count(0) == len(chunk):
                runs.append((0x00000002, sector, n, offset, 0))
            else:
                comp = zlib.compress(chunk, level)
                out.write(comp)
                data_crc = zlib.crc32(comp, data_crc)
                runs.append((0x80000005, sector, n, offset, len(comp)))
                offset += len(comp)
            sector += n
        runs.append((0xFFFFFFFF, sectors, 0, offset, 0))
        data_len = offset

        def checksum(value):
            return struct.pack('>II', 2, 32) + struct.pack('>I', value & 0xFFFFFFFF) + b'\0' * 124

        mish = struct.pack('>4sIQQQII', b'mish', 1, 0, sectors, 0, 0x208, 0xFFFFFFFF)
        mish += b'\0' * 24
        mish += checksum(part_crc)
        mish += struct.pack('>I', len(runs))
        assert len(mish) == 204
        for t, s, c, o, l in runs:
            mish += struct.pack('>IIQQQQ', t, 0, s, c, o, l)

        b64 = base64.encodebytes(mish).decode('ascii')
        b64 = ''.join('\t\t\t\t' + line + '\n' for line in b64.strip().split('\n'))
        xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>resource-fork</key>
	<dict>
		<key>blkx</key>
		<array>
			<dict>
				<key>Attributes</key>
				<string>0x0050</string>
				<key>CFName</key>
				<string>whole disk (Apple_HFS : 0)</string>
				<key>Data</key>
				<data>
{b64}				</data>
				<key>ID</key>
				<string>-1</string>
				<key>Name</key>
				<string>whole disk (Apple_HFS : 0)</string>
			</dict>
		</array>
	</dict>
</dict>
</plist>
'''.encode('utf-8')
        xml_offset = data_len
        out.write(xml)

        # Master checksum: CRC32 over each blkx checksum value (big-endian).
        master = zlib.crc32(struct.pack('>I', part_crc & 0xFFFFFFFF))

        koly = struct.pack('>4sIII', b'koly', 4, 512, 1)
        koly += struct.pack('>QQQQQ', 0, 0, data_len, 0, 0)
        koly += struct.pack('>II', 1, 1)
        koly += uuid.uuid4().bytes
        koly += checksum(data_crc)
        koly += struct.pack('>QQ', xml_offset, len(xml))
        koly += b'\0' * 120
        koly += checksum(master)
        koly += struct.pack('>IQIII', 1, sectors, 0, 0, 0)
        assert len(koly) == 512, len(koly)
        out.write(koly)
    return data_len, sectors


def main():
    args = sys.argv[1:]
    raw_keep = None
    if '--raw' in args:
        i = args.index('--raw')
        raw_keep = args[i + 1]
        del args[i:i + 2]
    if len(args) != 3:
        print(__doc__)
        sys.exit(2)
    staging, volname, out = args
    raw = raw_keep or out + '.hfs.tmp'
    size, nfiles, nfolders = build_hfs(staging, volname, raw)
    print(f'HFS+ volume: {size / 1e6:.1f} MB, {nfiles} files, {nfolders} folders')
    data_len, sectors = build_udif(raw, out)
    print(f'UDIF image: {os.path.getsize(out) / 1e6:.1f} MB ({sectors} sectors, {data_len} bytes compressed)')
    if not raw_keep:
        os.remove(raw)


if __name__ == '__main__':
    main()
