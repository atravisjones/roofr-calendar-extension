// attachment-viewer.js
// Bundled viewer for Roofr job-card attachments. Opened (background tab) by the service worker
// with ?u=<presigned file url>&t=<ext>&n=<name>. The raw S3 link has content-disposition=attachment
// baked into its signature (can't be stripped — breaks the sig -> 403), so navigating straight to
// it force-DOWNLOADS the file. Here we fetch the bytes instead (this extension page is granted the
// S3 host in host_permissions, so the fetch is CORS-exempt), wrap them in a blob (no disposition),
// and render inline: PDFs go to Chrome's native viewer, images to an <img>. On any failure we fall
// back to navigating to the raw URL (which downloads) so the click is never a dead end.
(async () => {
  const q = new URLSearchParams(location.search);
  const url = q.get('u');
  const ext = (q.get('t') || '').toLowerCase();
  const name = q.get('n') || '';
  const status = document.getElementById('status');
  if (name) document.title = name;
  if (!url) { status.textContent = 'No attachment URL.'; return; }

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const isPdf = ext === 'pdf' || (blob.type || '').toLowerCase().includes('pdf');

    if (isPdf) {
      // Replace this page with the blob PDF -> Chrome renders it inline in its native viewer.
      location.replace(blobUrl);
    } else {
      // Image (or anything Chrome can show in an <img>).
      const img = document.createElement('img');
      img.alt = name;
      img.src = blobUrl;
      document.body.replaceChildren(img);
    }
  } catch (err) {
    // CORS/expired/network — hand off to the raw URL so the user still gets the file (download).
    status.textContent = 'Could not preview — opening the file directly…';
    location.replace(url);
  }
})();
