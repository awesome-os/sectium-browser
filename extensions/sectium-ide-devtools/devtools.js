if (typeof chrome !== 'undefined' && chrome.devtools && chrome.devtools.panels) {
  chrome.devtools.panels.create(
    'Sectium IDE',
    '',
    'panel.html',
    () => {}
  );
}
