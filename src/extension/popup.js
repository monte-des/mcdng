// The toolbar popup: one click saves the article in the current tab, and the popup says what happened.

const stateEl = document.getElementById('state');
const detailEl = document.getElementById('detail');
const openButton = document.getElementById('open');

function show(state, detail = '', kind = '') {
  document.body.dataset.kind = kind;
  stateEl.textContent = state;
  detailEl.textContent = detail;
}

openButton.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'open-app' });
  window.close();
});

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.url?.startsWith(chrome.runtime.getURL(''))) {
    show('Open an article to save it', 'On the page of an article or on its PDF, click this button to save the PDF to the project open in MCdng.');
    return;
  }
  const result = await chrome.runtime.sendMessage({ type: 'save', tabId: tab.id });
  if (result.state === 'saved') show(`Saved to “${result.project}”`, result.title, 'done');
  else if (result.state === 'waiting') show('Saved, waiting for a project', `${result.title}. Open MCdng and a project: the paper is added to it.`, 'waiting');
  else show('Not saved', result.error, 'error');
})();
