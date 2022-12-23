# <img src="public/icons/icon_48.png" width="45" align="left"> StepFunctions Workflow Studio Sync

Third party Chrome extension that enables real time sync between StepFunctions Workflow Studio and your local file system

![Demo](images/demo.gif)

## Install
* Clone this repo
* run `npm run build`
* Open chrome://extensions
* Enable the "Developer mode" toggle 
* Click on the "Load unpacked" button
* Select the folder <project_root>/build

## Usage
This extension uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) to give Chrome temporary access to a single file on your filesystem.

1. Open [Workflow Studio](https://eu-west-1.console.aws.amazon.com/states/home?region=eu-west-1#/visual-editor?flowType=create)
2. Click the `Enable local sync` button at the top right corner
3. Select the YAML file you want to sync with. 
4. Start building!

Note that if you are modifying an existing state machine and use DefinitionSubstitutions, then you'll need to point the sync at the ASL file containing these substitutions in order to preserve them after the sync.

--- 

This project was bootstrapped with [Chrome Extension CLI](https://github.com/dutiyesh/chrome-extension-cli)
