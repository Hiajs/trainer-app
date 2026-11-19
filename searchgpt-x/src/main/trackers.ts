// A compact, built-in list of well-known third-party tracking and ad domains.
// Blocking is optional (Settings → Privacy) and only applies to third-party
// subresources, never to the page the user navigates to.

export const TRACKER_DOMAINS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'google-analytics.com', 'googletagmanager.com',
  'googletagservices.com', 'adservice.google.com', 'pagead2.googlesyndication.com', 'analytics.google.com',
  'facebook.net', 'connect.facebook.net', 'pixel.facebook.com', 'ads-twitter.com', 'analytics.twitter.com', 'static.ads-twitter.com',
  'ads.linkedin.com', 'px.ads.linkedin.com', 'snap.licdn.com', 'bat.bing.com', 'clarity.ms', 'ads.yahoo.com', 'analytics.yahoo.com',
  'scorecardresearch.com', 'quantserve.com', 'quantcount.com', 'chartbeat.com', 'chartbeat.net', 'hotjar.com', 'hotjar.io',
  'mixpanel.com', 'segment.io', 'segment.com', 'cdn.segment.com', 'api.segment.io', 'amplitude.com', 'heapanalytics.com',
  'fullstory.com', 'mouseflow.com', 'crazyegg.com', 'luckyorange.com', 'inspectlet.com', 'newrelic.com', 'nr-data.net',
  'adnxs.com', 'adsrvr.org', 'rubiconproject.com', 'pubmatic.com', 'openx.net', 'casalemedia.com', 'criteo.com', 'criteo.net',
  'taboola.com', 'outbrain.com', 'moatads.com', 'adform.net', 'serving-sys.com', 'smartadserver.com', 'teads.tv', 'yieldmo.com',
  'sharethrough.com', '3lift.com', 'triplelift.com', 'indexww.com', 'bidswitch.net', 'contextweb.com', 'districtm.io',
  'amazon-adsystem.com', 'media.net', 'zemanta.com', 'revcontent.com', 'mgid.com', 'adroll.com', 'perfectaudience.com',
  'demdex.net', 'omtrdc.net', 'everesttech.net', 'krxd.net', 'bluekai.com', 'exelator.com', 'rlcdn.com', 'tapad.com',
  'agkn.com', 'mathtag.com', 'mookie1.com', 'turn.com', 'eyeota.net', 'crwdcntrl.net', 'lijit.com', 'sovrn.com',
  'quantcast.com', 'tiqcdn.com', 'optimizely.com', 'branch.io', 'app-measurement.com', 'adjust.com', 'appsflyer.com',
  'kochava.com', 'braze.com', 'onesignal.com', 'yandex.ru/metrika', 'mc.yandex.ru', 'top-fwz1.mail.ru', 'hm.baidu.com',
  'cnzz.com', 'umeng.com', 'tiktok-analytics.com', 'analytics.tiktok.com', 'ads.tiktok.com', 'ads.pinterest.com', 'ct.pinterest.com',
  'sc-static.net', 'tr.snapchat.com', 'ads.reddit.com', 'alb.reddit.com', 'pixel.reddit.com', 'cdn.mxpnl.com', 'stats.wp.com',
  'pixel.wp.com', 'statcounter.com', 'gemius.pl', 'ioam.de', 'xiti.com', 'atdmt.com', 'adsafeprotected.com', 'doubleverify.com',
  'imrworldwide.com', 'comscore.com', 'parsely.com', 'cxense.com', 'permutive.com', 'id5-sync.com', 'liadm.com', 'pippio.com',
  'zeotap.com', 'smaato.net', 'inmobi.com', 'unityads.unity3d.com', 'applovin.com', 'vungle.com', 'chartboost.com'
];

const exact = new Set(TRACKER_DOMAINS.filter((d) => !d.includes('/')));

export function isTracker(hostname: string): boolean {
  let h = hostname.toLowerCase();
  while (h.includes('.')) {
    if (exact.has(h)) return true;
    h = h.slice(h.indexOf('.') + 1);
  }
  return false;
}

/** Registrable-ish domain (last two labels) used to decide if a request is third-party. */
export function baseDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split('.');
  if (parts.length <= 2) return parts.join('.');
  const twoPartTld = /^(co|com|org|net|ac|gov|edu)\.[a-z]{2}$/.test(parts.slice(-2).join('.'));
  return parts.slice(twoPartTld ? -3 : -2).join('.');
}
