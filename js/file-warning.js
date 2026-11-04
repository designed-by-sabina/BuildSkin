// Classic (non-module) script: runs even when the page is opened as a file,
// where the app's ES modules and data loading are blocked by the browser.
if (location.protocol === 'file:') {
  document.addEventListener('DOMContentLoaded', () => {
    const note = document.createElement('div');
    note.className = 'file-warning';
    note.innerHTML =
      'BuildSkin can’t run from a double-clicked file — the browser blocks loading the massings and scripts.<br>' +
      'Double-click <b>start.bat</b> in the BuildSkin folder instead (it opens <b>http://localhost:8765</b>).';
    document.body.prepend(note);
  });
}
