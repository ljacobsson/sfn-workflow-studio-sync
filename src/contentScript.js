'use strict';
const YAML = require('yaml');
const jp = require('jsonpath');
const { yamlParse, yamlDump } = require('yaml-cfn');

let aslFileHandle;
let samFileHandle;
let originalASLObj;
let substitutionMap;
let definitionButton;
let samTemplate;
const definitionButtonSelector = "//span[text()='Definition']";

async function init() {
  const config = { attributes: true, childList: true, subtree: true };

  const buttonText = document.evaluate(definitionButtonSelector, document, null, XPathResult.ANY_TYPE, null).iterateNext();
  if (!buttonText) return;
  definitionButton = buttonText.parentNode;
  const newButton = definitionButton.cloneNode(true);
  newButton.childNodes[0].textContent = "Enable local sync";
  definitionButton.parentNode.append(newButton);

  newButton.addEventListener("click", await linkASL(config, newButton));

}
init();

window.addEventListener('popstate', (event) => {
  window.setTimeout(() => {
    init();
  }, 1000);
});

async function linkASL(config, newButton) {
  return async () => {
    const forceSyncButton = definitionButton.cloneNode(true);
    const linkSAMButton = definitionButton.cloneNode(true);

    forceSyncButton.childNodes[0].textContent = "Force sync";
    linkSAMButton.childNodes[0].textContent = "Link SAM template";

    forceSyncButton.addEventListener("click", async () => {
      document.evaluate(definitionButtonSelector, document, null, XPathResult.ANY_TYPE, null).iterateNext().click();
    });
    linkSAMButton.addEventListener("click", async () => {
      await linkSAM();
    });

    [aslFileHandle] = await window.showOpenFilePicker({
      types: [
        {
          description: 'YAML files',
          accept: {
            'text/yaml': ['.yaml', '.yml'],
          },
        },
      ],
    });
    const originalASL = await aslFileHandle.getFile();
    originalASLObj = YAML.parse(await originalASL.text()) || {};
    const graphObserver = new MutationObserver(callback);
    const rightPanelObserver = new MutationObserver(callback);

    const targetNode = document.getElementsByClassName('graph-editor-container')[0];
    const rightPanel = document.getElementsByClassName('right-panel')[0];
    graphObserver.observe(targetNode, config);
    rightPanelObserver.observe(rightPanel, config);
    newButton.remove();
    definitionButton.parentNode.append(forceSyncButton);
    definitionButton.parentNode.append(linkSAMButton);
    forceSyncButton.click();

  };
}

async function linkSAM() {
  console.log("Linking SAM template");
  [samFileHandle] = await window.showOpenFilePicker({
    types: [
      {
        description: 'YAML files',
        accept: {
          'text/yaml': ['.yaml', '.yml'],
        },
      },
    ],
  });
  const samFile = await samFileHandle.getFile();
  samTemplate = yamlParse(await samFile.text()) || {};

  const field = document.evaluate("//span[text()='Enter ']", document, null, XPathResult.ANY_TYPE, null).iterateNext();
  console.log("field", field);

}

async function renderResources(manualInputField) {
  const dropdown = document.createElement("select");
  dropdown.id = "substitution-dropdown";
  dropdown.style = "width: 100%;";
  dropdown.innerHTML = `<option value="">Select a resource</option>`;
  for (const resource of Object.keys(samTemplate.Resources).sort()) {
    // create a dropdown for each resource
    const resourceObj = samTemplate.Resources[resource];
    dropdown.innerHTML += `<option value="${resource}">${resource}</option>`;
  }
  console.log("dropdown", dropdown);
  manualInputField.parentNode.parentNode.parentNode.parentNode.parentNode.parentNode.parentNode.parentNode.parentNode.parentNode.parentNode.append(dropdown);
  

}

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

      const writableStream = await aslFileHandle.createWritable();

      let yamlASL = YAML.stringify(asl);
      for (const sub of substitutionMap) {
        yamlASL = yamlASL.split(sub.value).join(sub.key);
      }
      await writableStream.write(yamlASL);

      await writableStream.close();
      document.evaluate("//span[text()='Form']", document, null, XPathResult.ANY_TYPE, null).iterateNext().click();
    }

    console.log(mutation);
    const manualInputField = document.evaluate("//span[text()='Enter ']", document, null, XPathResult.ANY_TYPE, null).iterateNext();
    if (manualInputField) {
      renderResources(manualInputField);
    }
  }
};

