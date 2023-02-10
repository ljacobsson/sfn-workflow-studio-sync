'use strict';
const YAML = require('yaml');
const jp = require('jsonpath');
const { yamlParse, yamlDump } = require('yaml-cfn');
const cfnSchema = { ...require('../schema/cfn-resource-specification.json').ResourceTypes, ...require('../schema/sam-resource-specification.json').ResourceTypes }
let aslFileHandle;
let samFileHandle;
let originalASLObj;
let substitutionMap;
let definitionButton;
let samTemplate;
let definitionContentLocked = false;
let forceSyncButton;
const definitionButtonSelector = "//span[text()='Definition']";

async function init() {
  const config = { attributes: true, childList: true, subtree: true };

  const buttonText = document.evaluate(definitionButtonSelector, document, null, XPathResult.ANY_TYPE, null).iterateNext();
  if (!buttonText) return;
  definitionButton = buttonText.parentNode;
  const newButton = definitionButton.cloneNode(true);
  newButton.childNodes[0].textContent = "Link local ASL definition";
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
    forceSyncButton = definitionButton.cloneNode(true);
    const linkSAMButton = definitionButton.cloneNode(true);

    forceSyncButton.childNodes[0].textContent = "Force sync";
    linkSAMButton.childNodes[0].textContent = "Link SAM template";

    forceSyncButton.addEventListener("click", async () => {
      document.evaluate(definitionButtonSelector, document, null, XPathResult.ANY_TYPE, null).iterateNext().click();
    });
    linkSAMButton.addEventListener("click", async () => {
      await linkSAM();
      linkSAMButton.remove();
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

  const field = document.evaluate("//span[text()='Enter ']", document, null, XPathResult.ANY_TYPE, null).iterateNext();

}

async function getTemplate() {
  if (!samFileHandle) return null;
  const samFile = await samFileHandle.getFile();
  return yamlParse(await samFile.text()) || {};

}

async function dropdownChange(dropdown, resourceNameOverride) {

  const substitutionName = resourceNameOverride || dropdown.value.split("|")[0];
  const resourceName = dropdown.value.split("|")[0];
  const intrinsicFunction = dropdown.value.split("|")[1];
  let attribute;
  if (intrinsicFunction !== "Ref") {
    attribute = dropdown.value.split("|")[2];
  }
  const samTemplate = await getTemplate();

  const stateMachine = getStateMachineFromSAM(samTemplate);

  const stateMachineResource = samTemplate.Resources[stateMachine];
  stateMachineResource.Properties.DefinitionSubstitutions = stateMachineResource.Properties.DefinitionSubstitutions || {};
  if (intrinsicFunction === "Ref") {
    stateMachineResource.Properties.DefinitionSubstitutions[substitutionName] = { "Ref": resourceName };
  } else {
    stateMachineResource.Properties.DefinitionSubstitutions[substitutionName] = { "Fn::GetAtt": [resourceName, attribute] };
  }

  const writableStream = await samFileHandle.createWritable();

  let yaml = yamlDump(samTemplate);
  await writableStream.write(yaml);
  await writableStream.close();

  const input = dropdown.parentNode.parentNode.parentNode.parentNode.querySelector("input[type=text]");
  if (input) {
    input.value = '${' + resourceName + '}';
    var event = new Event('input', { bubbles: true });
    input.dispatchEvent(event);
  }
  setTimeout(async () => {
    forceSyncButton.click();
    setTimeout(async () => {
      const asl = await (await aslFileHandle.getFile()).text();
      for (const sub of Object.keys(stateMachineResource.Properties.DefinitionSubstitutions)) {
        if (!asl.includes("${" + sub + "}")) {
          delete stateMachineResource.Properties.DefinitionSubstitutions[sub];
          const writableStream = await samFileHandle.createWritable();
          let yaml = yamlDump(samTemplate);
          await writableStream.write(yaml);
          await writableStream.close();
        }
      }

    }, 300);

  }, 300);
}

function getStateMachineFromSAM(samTemplate) {
  return Object.keys(samTemplate.Resources).find((resource) => samTemplate.Resources[resource].Type === "AWS::Serverless::StateMachine" && samTemplate.Resources[resource].Properties.DefinitionUri.includes(aslFileHandle.name));
}

async function renderResources(manualInputField) {
  if (document.getElementById("substitution-dropdown")) {
    return;
  }
  const dropdown = await createSAMDropdown();

  if (!definitionContentLocked) {
    definitionContentLocked = true;
    if (!document.getElementById("substitution-dropdown")) {
      manualInputField.parentNode.parentNode.parentNode.parentNode.parentNode.parentNode.parentNode.parentNode.parentNode.parentNode.parentNode.parentNode.append(dropdown);
    }
  }

}

async function createSAMDropdown(id) {
  const samTemplate = await getTemplate();
  if (!samTemplate) return null;
  const stateMachine = samTemplate.Resources[getStateMachineFromSAM(samTemplate)];
  let substitution = null;
  if (stateMachine.Properties.DefinitionSubstitutions) {
    substitution = stateMachine.Properties.DefinitionSubstitutions[id];
  }
  const dropdown = document.createElement("select");
  dropdown.id = "substitution-dropdown" + (id || "");
  dropdown.style = "width: 100%;";
  dropdown.innerHTML = `<option value="">Select a resource</option>`;

  for (const resource of Object.keys(samTemplate.Resources).sort()) {
    const resourceObj = samTemplate.Resources[resource];
    const attributes = (cfnSchema[resourceObj.Type] || {}).Attributes || {};
    dropdown.innerHTML += `<optgroup label="${resource} (${resourceObj.Type})"></option>`;
    dropdown.innerHTML += `<option value="${resource}|Ref">Ref</option>`;
    for (const attribute of Object.keys(attributes)) {
      let selected = "";
      if (substitution && substitution["Fn::GetAtt"] && substitution["Fn::GetAtt"][0] === resource && substitution["Fn::GetAtt"][1] === attribute) {
        selected = "selected";
      } else if (substitution && substitution["Ref"] === resource) {
        selected = "selected";
      }
      dropdown.innerHTML += `<option value="${resource}|GetAtt|${attribute}|${id}" ${selected}>${resource}.${attribute}</option>`;
    }
    dropdown.innerHTML += `</optgroup>`;
  }
  dropdown.onchange = async () => await dropdownChange(dropdown, id);

  return dropdown;
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
let hasSynced = false;
let oldHtml = "";
const callback = async (mutationList, observer) => {
  for (const mutation of mutationList) {
    if (mutation.target.classList && mutation.target.classList.contains("node") && mutation.target.classList.contains("selected")) {
      const innerHTML = document.getElementsByClassName("nodes")[0].innerHTML;
      if (oldHtml.length !== innerHTML.length) {
        oldHtml = innerHTML;
        definitionButton.click();
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

    const manualInputField = document.evaluate("//span[text()='Enter ']", document, null, XPathResult.ANY_TYPE, null).iterateNext();
    if (manualInputField && !definitionContentLocked) {
      renderResources(manualInputField);
    } else {
      definitionContentLocked = false;
    }

    if (mutation.target.classList && mutation.target.classList.contains("CodeMirror-code") && !hasSynced && samFileHandle) {
      const codeMirror = document.getElementsByClassName("CodeMirror-code")[0];
      if (!codeMirror || !codeMirror.innerHTML) continue;
      let matches = codeMirror.innerHTML.match(/\${(.+?)}/g);
      if (matches && matches.length) {
        matches = matches.filter(p => !p.includes(" ")).map(p => p.replace("${", "").replace("}", ""));

        let div = document.createElement("div");
        div.id = "substitution-map";
        div.style = "padding-top: 20px;";
        div.innerHTML += `<h4>Map definition substitutions with SAM template</h4>`;
        for (const match of matches) {
          div.innerHTML += `<span>${match}</span>`;
          const dropdown = await createSAMDropdown(match);
          div.append(dropdown)
        }
        if (document.getElementById("substitution-map")) {
          document.getElementById("substitution-map").remove();
        }
        document.getElementsByClassName("react-codemirror2")[0].parentNode.parentNode.append(div);
      }
    }
  }
};

