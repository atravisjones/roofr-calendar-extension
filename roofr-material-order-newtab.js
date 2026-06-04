// roofr-material-order-newtab.js
// Runs in the MAIN world (page context) so it can read React fiber/props off DOM
// nodes — the isolated content.js cannot. Material-order cards have no in-DOM id and
// no job-scoped REST endpoint, so we read the material order's UUID straight from the
// React fiber and open the deep-link on middle-click / Ctrl+Cmd-click of its "View"
// button. Also handles CALENDAR events (job id at event.originalEvt.job_id in fiber) ->
// opens that job's card. (Proposals, PDF-signer docs, invoices, work orders, and job
// list/board rows are handled in content.js via DOM/API; material orders and calendar
// events are the ones that need fiber.) Opens go through content.js -> SW background tab.
(() => {
  if (window.__roofrMatOrderNewTab) return;
  window.__roofrMatOrderNewTab = true;

  const teamId = () => (location.pathname.match(/\/dashboard\/team\/(\d+)/) || [])[1] || null;

  function fiberOf(el) {
    const k = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    return k ? el[k] : null;
  }

  // Walk up the fiber tree from `el`; return the material order's UUID.
  // The card component receives the order as memoizedProps.materialOrder (found ~depth 7).
  // Fallback: any props object shaped like a material order (id + delivery_option/supplier).
  function materialOrderId(el) {
    let f = fiberOf(el), depth = 0;
    while (f && depth < 40) {
      const p = f.memoizedProps;
      if (p && typeof p === 'object') {
        const mo = p.materialOrder;
        if (mo && typeof mo === 'object' && mo.id) return String(mo.id);
        for (const k of Object.keys(p)) {
          const v = p[k];
          if (v && typeof v === 'object' && !Array.isArray(v) && v.id &&
              ('delivery_option' in v || 'supplier' in v) && 'number' in v) {
            return String(v.id);
          }
        }
      }
      f = f.return; depth++;
    }
    return null;
  }

  // A material-order "View" button: exact text "View", inside a .card--material-order.
  function matViewBtn(target) {
    const b = target.closest && target.closest('button');
    if (!b || !/^\s*View\s*$/.test(b.textContent || '')) return null;
    return b.closest('.card--material-order') ? b : null;
  }

  // MAIN world has no chrome.* APIs; hand off to content.js (isolated) which asks the
  // service worker to open a BACKGROUND tab so focus isn't stolen.
  function openBg(url) { window.postMessage({ __roofrBgTab: url }, location.origin); }

  // A PDF/image attachment card (.file-preview) carries no in-DOM URL — the real file lives
  // in React fiber under memoizedProps.attachment.fileUrl (an S3 presigned link). We read it
  // and hand it to content.js -> SW, which opens the bundled attachment viewer (it re-serves
  // the bytes inline so the file VIEWS in a tab instead of force-downloading; see SW handler).
  function attachmentInfo(el) {
    let f = fiberOf(el), depth = 0;
    while (f && depth < 20) {
      const p = f.memoizedProps;
      if (p && p.attachment && typeof p.attachment === 'object' && p.attachment.fileUrl) {
        const a = p.attachment;
        return {
          url: String(a.fileUrl),
          name: String(a.name || ''),
          ext: String(a.fileExtension || '').toLowerCase().replace(/^\./, '')
        };
      }
      f = f.return; depth++;
    }
    return null;
  }
  function openAttachment(info) { window.postMessage({ __roofrAttachmentTab: info }, location.origin); }

  // A calendar event's job id lives in React fiber under memoizedProps.event. Roofr re-renders
  // events into a heavier "editor" shape after you interact with one (e.g. open its popover),
  // which swaps originalEvt.job_id for an originalEvt.job object — so read BOTH forms (plus a
  // top-level event.job_id) to stay correct before AND after interaction. Returns null for
  // events with no job (meetings, out-of-office, unavailable) so they're skipped.
  function calendarEventJobId(el) {
    let f = fiberOf(el), depth = 0;
    while (f && depth < 25) {
      const p = f.memoizedProps;
      if (p && p.event && typeof p.event === 'object') {
        const ev = p.event, oe = ev.originalEvt || {};
        const jid = oe.job_id || (oe.job && oe.job.id) || ev.job_id;
        return /^\d+$/.test(String(jid || '')) ? String(jid) : null;
      }
      f = f.return; depth++;
    }
    return null;
  }

  function handle(e) {
    try {
      const mid = e.type === 'auxclick' && e.button === 1;
      const mod = e.type === 'click' && (e.ctrlKey || e.metaKey);
      if (!mid && !mod) return;
      // (0) Attachment card (.file-preview) -> open the file inline in a new tab. Needs no teamId.
      const fileCard = e.target.closest && e.target.closest('.file-preview');
      if (fileCard) {
        const info = attachmentInfo(fileCard);
        if (info && info.url) { e.preventDefault(); e.stopPropagation(); openAttachment(info); }
        return;
      }
      const tid = teamId();
      if (!tid) return;
      // (1) Material-order "View" button.
      const btn = matViewBtn(e.target);
      if (btn) {
        const id = materialOrderId(btn);
        if (id) { e.preventDefault(); e.stopPropagation(); openBg(`https://app.roofr.com/dashboard/team/${tid}/material-order/${id}/preview`); }
        return;
      }
      // (2) Calendar event -> open its job's card (job id read from event fiber).
      if (location.pathname.includes('/calendar')) {
        const jid = calendarEventJobId(e.target);
        if (jid) { e.preventDefault(); e.stopPropagation(); openBg(`https://app.roofr.com/dashboard/team/${tid}/jobs/list-view?selectedJobId=${jid}`); }
      }
    } catch (err) { /* never throw into the page */ }
  }

  document.addEventListener('auxclick', handle, true);
  document.addEventListener('click', handle, true);

  // Expose the open job's id (read from React fiber) as data-roofr-job-id on <html>, so the
  // isolated-world content.js can resolve proposals / PDF docs / work orders even when the job
  // card is opened on a URL WITHOUT ?selectedJobId= (e.g. "View job details" from a proposal).
  // DOM attributes are shared across the MAIN/isolated worlds; fiber is not. Set on mousedown,
  // which fires before the click/auxclick that content.js handles.
  function jobIdFromFiber(el) {
    let f = fiberOf(el), depth = 0;
    while (f && depth < 30) {
      const p = f.memoizedProps;
      if (p && typeof p === 'object') {
        for (const k of Object.keys(p)) {
          const v = p[k];
          if (v && typeof v === 'object' && /^\d+$/.test(String(v.job_id || ''))) return String(v.job_id);
        }
      }
      f = f.return; depth++;
    }
    return null;
  }
  document.addEventListener('mousedown', (e) => {
    try {
      const jid = jobIdFromFiber(e.target);
      if (jid) document.documentElement.dataset.roofrJobId = jid;
      // Suppress the middle-click autoscroll cursor over a calendar event we're about to hijack.
      if (e.button === 1 && location.pathname.includes('/calendar') && calendarEventJobId(e.target)) e.preventDefault();
      // Same for an attachment card we're about to hijack.
      if (e.button === 1 && e.target.closest && e.target.closest('.file-preview') && attachmentInfo(e.target.closest('.file-preview'))) e.preventDefault();
    } catch (err) { /* never throw into the page */ }
  }, true);

  console.log('[RoofrNewTab] material-order + calendar + job-id MAIN-world handler registered');
})();
