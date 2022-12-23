'use strict';
const YAML = require('yaml');
const jp = require('jsonpath');

let fileHandle, writableStream;
let originalASLObj;
let substitutionMap;
let definitionButton;

function init() {
  const config = { attributes: true, childList: true, subtree: true };
  const buttonText = document.evaluate("//span[text()='Definition']", document, null, XPathResult.ANY_TYPE, null).iterateNext();
  if (!buttonText) return;
  definitionButton = buttonText.parentNode;
  const newButton = definitionButton.cloneNode(true);
  const forceSyncButton = definitionButton.cloneNode(true);

  newButton.childNodes[0].textContent = "Enable local sync";
  forceSyncButton.childNodes[0].textContent = "Force sync";
  definitionButton.parentNode.append(newButton);

  forceSyncButton.addEventListener("click", async () => {
    document.evaluate("//span[text()='Definition']", document, null, XPathResult.ANY_TYPE, null).iterateNext().click();
  });

  newButton.addEventListener("click", async () => {
    [fileHandle] = await window.showOpenFilePicker({
      types: [
        {
          description: 'YAML files',
          accept: {
            'text/yaml': ['.yaml', '.yml'],
          },
        },
      ],      
    });
    writableStream = await fileHandle.createWritable();
    const originalASL = await fileHandle.getFile();
    originalASLObj = YAML.parse(await originalASL.text()) || {};
    const graphObserver = new MutationObserver(callback);
    const rightPanelObserver = new MutationObserver(callback);

    const targetNode = document.getElementsByClassName('graph-editor-container')[0];
    const rightPanel = document.getElementsByClassName('right-panel')[0];
    graphObserver.observe(targetNode, config);
    rightPanelObserver.observe(rightPanel, config);
    newButton.remove();
    definitionButton.parentNode.append(forceSyncButton);
    forceSyncButton.click();
  });
}
init();

window.addEventListener('popstate', (event) => {
  window.setTimeout(() => {
    init();
  }, 1000);
});

function getSubstitutionPaths(doc, definition) {
  const paths = [];
  const getPath = (currPath, item) => {
    if (Array.isArray(item)) {
      item.forEach((el, idx) => getPath(`${currPath}.${idx}`, el));
    } else if (typeof item == "object") {
      Object.entries(item || {}).forEach(([key, value]) => {
        if (key.includes(" ")) key = `["${key}"]`;
        else key = `.${key}`;
        getPath(`${currPath}${key}`, value);
        if (typeof value === "string" && value.startsWith("${")) {
          paths.push(`$.${currPath}${key}`);
        }
      });
    }
  };
  Object.entries(doc).forEach(([key, value]) => {
    getPath(key, value);
  });

  const substitutionMap = [];
  for (const substitutionPath of paths) {
    const subKey = jp.value(doc, substitutionPath);
    const value = jp.value(definition, substitutionPath);
    if (!value) {
      console.log(`No value found for ${substitutionPath} in StateMachine ASL. If the JSON path has changed locally, please do a full infra deploy.`);
      continue;
    }
    if (!substitutionMap.find(p => p.key === subKey)) {
      substitutionMap.push({ key: subKey, value: value });
    }
  }
  return substitutionMap;
}

const callback = async (mutationList, observer) => {
  let hasSynced = false;
  for (const mutation of mutationList) {
    if (mutation.target.classList && mutation.target.classList.contains("node-container") || mutation.target.classList.contains("nodes")) {
      if (!hasSynced) {
        definitionButton.click();
        hasSynced = true;
      }
    }
    if (mutation.target.classList && mutation.target.classList.contains("state-definition") && document.getElementsByClassName("json")[0]) {

      const json = document.getElementsByClassName("json")[0].innerText.replace(/\n/g, '').replace(/ /g, '');
      const asl = JSON.parse(json);
      if (!substitutionMap) {
        substitutionMap = getSubstitutionPaths(originalASLObj, asl);
      }

      const writableStream = await fileHandle.createWritable();

      let yamlASL = YAML.stringify(asl);
      for (const sub of substitutionMap) {
        yamlASL = yamlASL.split(sub.value).join(sub.key);
      }
      await writableStream.write(yamlASL);

      await writableStream.close();
      document.evaluate("//span[text()='Form']", document, null, XPathResult.ANY_TYPE, null).iterateNext().click();
    }
  }
};

