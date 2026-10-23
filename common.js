// Link -> player info (YouTube, Vimeo, Dailymotion, direct mp4/webm/m3u8-less files, fallback iframe)
function parseVideo(link) {
  let u;
  try { u = new URL(link); } catch { return { type: 'iframe', embed: link, thumb: '' }; }
  const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');

  // YouTube
  let yt = null;
  if (host === 'youtu.be') yt = u.pathname.slice(1).split('/')[0];
  else if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    if (u.pathname === '/watch') yt = u.searchParams.get('v');
    else { const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([\w-]{6,})/); if (m) yt = m[2]; }
  }
  if (yt) return {
    type: 'iframe', yt,
    embed: `https://www.youtube.com/embed/${yt}?autoplay=1&rel=0`,
    thumb: `https://img.youtube.com/vi/${yt}/hqdefault.jpg`
  };

  // Vimeo
  if (host.endsWith('vimeo.com')) {
    const m = u.pathname.match(/(\d{5,})/);
    if (m) return { type: 'iframe', embed: `https://player.vimeo.com/video/${m[1]}?autoplay=1`, thumb: '' };
  }

  // Dailymotion
  if (host.endsWith('dailymotion.com') || host === 'dai.ly') {
    const m = u.pathname.match(/video\/([\w]+)/) || u.pathname.match(/^\/([\w]+)$/);
    if (m) return { type: 'iframe', embed: `https://www.dailymotion.com/embed/video/${m[1]}?autoplay=1`, thumb: '' };
  }

  // Direct file
  if (/\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(u.pathname + u.search)) {
    return { type: 'video', embed: link, thumb: '' };
  }

  return { type: 'iframe', embed: link, thumb: '' };
}

// short hai ya video? type set hai to wahi; purani entries (type nahi) me /shorts/ link ho to short
function isShortVideo(v) {
  return v.type ? v.type === 'short' : /\/shorts\//i.test(v.url || '');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}