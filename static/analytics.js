/* Custom events for the Umami tracker the index route adds when
 * UMAMI_WEBSITE_ID is set. Same wrapper as vinyl-collection's.
 *
 * Analytics must never cost the app anything: with no tracker on the page
 * (local runs, the tests, an ad blocker, the deferred script not loaded yet)
 * every call is a silent no-op, and a tracker that throws is swallowed.
 * Values are trimmed to what Umami keeps (50-character event names,
 * 500-character strings) and empty ones dropped.
 *
 * Nothing from inside a conversation is ever sent: no names, no title, no
 * words, no file name. chatSummary is the only way chat data reaches an
 * event, and it keeps just the export's shape, with counts rounded into bands.
 *
 * Loaded as a plain script in the browser; required as a module by the tests. */

const ChatAnalytics = (function () {

  const NAME_MAX = 50;
  const VALUE_MAX = 500;

  function clean(data) {
    if (!data) return undefined;
    const out = {};
    Object.keys(data).forEach(k => {
      const v = data[k];
      if (v === null || v === undefined || v === '') return;
      out[k] = typeof v === 'string' ? v.slice(0, VALUE_MAX) : v;
    });
    return out;
  }

  /* `tracker` is for the tests; the page leaves it out and gets window.umami. */
  function track(name, data, tracker) {
    const t = arguments.length > 2 ? tracker
      : (typeof window !== 'undefined' ? window.umami : undefined);
    if (!name || !t || typeof t.track !== 'function') return false;
    try {
      t.track(String(name).slice(0, NAME_MAX), clean(data));
      return true;
    } catch (e) {
      return false;
    }
  }

  function sizeBucket(n) {
    if (n < 1e3) return '<1k';
    if (n < 1e4) return '1k-10k';
    if (n < 1e5) return '10k-100k';
    return '100k+';
  }

  /* The /api/parse response and the uploaded file's name → event data. */
  function chatSummary(chat, filename) {
    chat = chat || {};
    const people = (chat.people || []).length;
    return {
      platform: chat.platform,
      language: chat.language,
      kind: people > 2 ? 'group' : 'pair',
      people,
      size: sizeBucket((chat.rows || []).length),
      source: /\.zip$/i.test(filename || '') ? 'zip' : 'txt',
    };
  }

  return { track, sizeBucket, chatSummary };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ChatAnalytics;
