/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azdata from 'azdata';
import { createWriteStream, promises as fs } from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { DeploymentProvider, instanceOfAzureSQLVMDeploymentProvider, instanceOfAzureSQLDBDeploymentProvider, instanceOfCommandDeploymentProvider, instanceOfDialogDeploymentProvider, instanceOfDownloadDeploymentProvider, instanceOfNotebookBasedDialogInfo, instanceOfNotebookDeploymentProvider, instanceOfNotebookWizardDeploymentProvider, instanceOfWebPageDeploymentProvider, instanceOfWizardDeploymentProvider, NotebookInfo, NotebookPathInfo, ResourceType, ResourceTypeOption } from '../interfaces';
import { DeployAzureSQLVMWizard } from '../ui/deployAzureSQLVMWizard/deployAzureSQLVMWizard';
import { DeployAzureSQLDBWizard } from '../ui/deployAzureSQLDBWizard/deployAzureSQLDBWizard';
import { DeployClusterWizard } from '../ui/deployClusterWizard/deployClusterWizard';
import { DeploymentInputDialog } from '../ui/deploymentInputDialog';
import { NotebookWizard } from '../ui/notebookWizard/notebookWizard';
import { AzdataService } from './azdataService';
import { KubeService } from './kubeService';
import { INotebookService } from './notebookService';
import { IPlatformService } from './platformService';
import { IToolsService } from './toolsService';
import * as loc from './../localizedConstants';

const localize = nls.loadMessageBundle();

export interface IResourceTypeService {
	getResourceTypes(filterByPlatform?: boolean): ResourceType[];
	validateResourceTypes(resourceTypes: ResourceType[]): string[];
	startDeployment(resourceType?: ResourceType): void;
	startDeploymentFromWizard(provider: DeploymentProvider, resourceType?: ResourceType): void;
}

export class ResourceTypeService implements IResourceTypeService {
	private _resourceTypes: ResourceType[] = [];

	constructor(private platformService: IPlatformService, private toolsService: IToolsService, private notebookService: INotebookService) { }

	/**
	 * Get the supported resource types
	 * @param filterByPlatform indicates whether to return the resource types supported on current platform.
	 */
	getResourceTypes(filterByPlatform: boolean = true): ResourceType[] {
		if (this._resourceTypes.length === 0) {
			vscode.extensions.all.forEach((extension) => {
				const extensionResourceTypes = extension.packageJSON.contributes && extension.packageJSON.contributes.resourceDeploymentTypes as ResourceType[];
				if (extensionResourceTypes) {
					extensionResourceTypes.forEach((resourceType: ResourceType) => {
						this.updatePathProperties(resourceType, extension.extensionPath);
						resourceType.getProvider = (selectedOptions) => { return this.getProvider(resourceType, selectedOptions); };
						resourceType.getOkButtonText = (selectedOptions) => { return this.getOkButtonText(resourceType, selectedOptions); };
						this._resourceTypes.push(resourceType);
					});
				}
			});
		}

		let resourceTypes = this._resourceTypes;
		if (filterByPlatform) {
			resourceTypes = resourceTypes.filter(resourceType => (typeof resourceType.platforms === 'string' && resourceType.platforms === '*') || resourceType.platforms.includes(this.platformService.platform()));
		}

		return resourceTypes;
	}

	private updatePathProperties(resourceType: ResourceType, extensionPath: string): void {
		resourceType.icon.dark = path.join(extensionPath, resourceType.icon.dark);
		resourceType.icon.light = path.join(extensionPath, resourceType.icon.light);
		resourceType.providers.forEach((provider) => {
			if (instanceOfNotebookDeploymentProvider(provider)) {
				this.updateNotebookPath(provider, extensionPath);
			} else if (instanceOfDialogDeploymentProvider(provider) && instanceOfNotebookBasedDialogInfo(provider.dialog)) {
				this.updateNotebookPath(provider.dialog, extensionPath);
			}
			else if ('bdcWizard' in provider) {
				this.updateNotebookPath(provider.bdcWizard, extensionPath);
			}
			else if ('notebookWizard' in provider) {
				this.updateNotebookPath(provider.notebookWizard, extensionPath);
			}
			else if ('azureSQLVMWizard' in provider) {
				this.updateNotebookPath(provider.azureSQLVMWizard, extensionPath);
			}
			else if ('azureSQLDBWizard' in provider) {
				this.updateNotebookPath(provider.azureSQLDBWizard, extensionPath);
			}
		});
	}

	private updateNotebookPath(objWithNotebookProperty: { notebook: string | NotebookPathInfo | NotebookInfo[] } | undefined, extensionPath: string): void {
		if (objWithNotebookProperty && objWithNotebookProperty.notebook) {
			if (typeof objWithNotebookProperty.notebook === 'string') {
				objWithNotebookProperty.notebook = path.join(extensionPath, objWithNotebookProperty.notebook);
			} else if (Array.isArray(objWithNotebookProperty.notebook)) {
				objWithNotebookProperty.notebook.forEach(nb => {
					nb.path = path.join(extensionPath, nb.path);
				});
			} else {
				if (objWithNotebookProperty.notebook.darwin) {
					objWithNotebookProperty.notebook.darwin = path.join(extensionPath, objWithNotebookProperty.notebook.darwin);
				}
				if (objWithNotebookProperty.notebook.win32) {
					objWithNotebookProperty.notebook.darwin = path.join(extensionPath, objWithNotebookProperty.notebook.win32);
				}
				if (objWithNotebookProperty.notebook.linux) {
					objWithNotebookProperty.notebook = path.join(extensionPath, objWithNotebookProperty.notebook.linux);
				}
			}
		}
	}

	/**
	 * Validate the resource types and returns validation error messages if any.
	 * @param resourceTypes resource types to be validated
	 */
	validateResourceTypes(resourceTypes: ResourceType[]): string[] {
		// NOTE: The validation error messages do not need to be localized as it is only meant for the developer's use.
		const errorMessages: string[] = [];
		if (!resourceTypes || resourceTypes.length === 0) {
			errorMessages.push('Resource type list is empty');
		} else {
			let resourceTypeIndex = 1;
			resourceTypes.forEach(resourceType => {
				this.validateResourceType(resourceType, `resource type index: ${resourceTypeIndex}`, errorMessages);
				resourceTypeIndex++;
			});
		}

		return errorMessages;
	}

	private validateResourceType(resourceType: ResourceType, positionInfo: string, errorMessages: string[]): void {
		this.validateNameDisplayName(resourceType, 'resource type', positionInfo, errorMessages);
		if (!resourceType.icon || !resourceType.icon.dark || !resourceType.icon.light) {
			errorMessages.push(`Icon for resource type is not specified properly. ${positionInfo} `);
		}

		if (resourceType.options && resourceType.options.length > 0) {
			let optionIndex = 1;
			resourceType.options.forEach(option => {
				const optionInfo = `${positionInfo}, option index: ${optionIndex} `;
				this.validateResourceTypeOption(option, optionInfo, errorMessages);
				optionIndex++;
			});
		}

		this.validateProviders(resourceType, positionInfo, errorMessages);
	}

	private validateResourceTypeOption(option: ResourceTypeOption, positionInfo: string, errorMessages: string[]): void {
		this.validateNameDisplayName(option, 'option', positionInfo, errorMessages);
		if (!option.values || option.values.length === 0) {
			errorMessages.push(`Option contains no values.${positionInfo} `);
		} else {
			let optionValueIndex = 1;
			option.values.forEach(optionValue => {
				const optionValueInfo = `${positionInfo}, option value index: ${optionValueIndex} `;
				this.validateNameDisplayName(optionValue, 'option value', optionValueInfo, errorMessages);
				optionValueIndex++;
			});

			// Make sure the values are unique
			for (let i = 0; i < option.values.length; i++) {
				if (option.values[i].name && option.values[i].displayName) {
					let dupePositions = [];
					for (let j = i + 1; j < option.values.length; j++) {
						if (option.values[i].name === option.values[j].name
							|| option.values[i].displayName === option.values[j].displayName) {
							// +1 to make the position 1 based.
							dupePositions.push(j + 1);
						}
					}

					if (dupePositions.length !== 0) {
						errorMessages.push(`Option values with same name or display name are found at the following positions: ${i + 1}, ${dupePositions.join(',')}.${positionInfo} `);
					}
				}
			}
		}
	}

	private validateProviders(resourceType: ResourceType, positionInfo: string, errorMessages: string[]): void {
		if (!resourceType.providers || resourceType.providers.length === 0) {
			errorMessages.push(`No providers defined for resource type, ${positionInfo}`);
		} else {
			let providerIndex = 1;
			resourceType.providers.forEach(provider => {
				const providerPositionInfo = `${positionInfo}, provider index: ${providerIndex} `;
				if (!instanceOfWizardDeploymentProvider(provider)
					&& !instanceOfNotebookWizardDeploymentProvider(provider)
					&& !instanceOfDialogDeploymentProvider(provider)
					&& !instanceOfNotebookDeploymentProvider(provider)
					&& !instanceOfDownloadDeploymentProvider(provider)
					&& !instanceOfWebPageDeploymentProvider(provider)
					&& !instanceOfCommandDeploymentProvider(provider)
					&& !instanceOfAzureSQLVMDeploymentProvider(provider)
					&& !instanceOfAzureSQLDBDeploymentProvider(provider)) {
					errorMessages.push(`No deployment method defined for the provider, ${providerPositionInfo}`);
				}

				if (provider.requiredTools && provider.requiredTools.length > 0) {
					provider.requiredTools.forEach(tool => {
						if (!this.toolsService.getToolByName(tool.name)) {
							errorMessages.push(`The tool is not supported: ${tool.name}, ${providerPositionInfo} `);
						}
					});
				}
				providerIndex++;
			});
		}
	}

	private validateNameDisplayName(obj: { name: string; displayName: string }, type: string, positionInfo: string, errorMessages: string[]): void {
		if (!obj.name) {
			errorMessages.push(`Name of the ${type} is empty.${positionInfo} `);
		}
		if (!obj.displayName) {
			errorMessages.push(`Display name of the ${type} is empty.${positionInfo} `);
		}
	}

	/**
	 * Get the provider based on the selected options
	 */
	private getProvider(resourceType: ResourceType, selectedOptions: { option: string, value: string }[]): DeploymentProvider | undefined {
		for (let i = 0; i < resourceType.providers.length; i++) {
			const provider = resourceType.providers[i];
			if (processWhenClause(provider.when, selectedOptions)) {
				return provider;
			}
		}
		return undefined;
	}

	/**
	 * Get the ok button text based on the selected options
	 */
	private getOkButtonText(resourceType: ResourceType, selectedOptions: { option: string, value: string }[]): string | undefined {
		if (resourceType.okButtonText) {
			for (const possibleOption of resourceType.okButtonText) {
				if (processWhenClause(possibleOption.when, selectedOptions)) {
					return possibleOption.value;
				}
			}
		}
		return loc.select;
	}

	public startDeployment(resourceType: ResourceType): void {
		const provider = <DeploymentProvider>resourceType?.providers[0];
		if (instanceOfAzureSQLVMDeploymentProvider(provider)) {
			const wizard = new DeployAzureSQLVMWizard(this.notebookService, this.toolsService, resourceType, this);
			wizard.open();
		} else if (instanceOfAzureSQLDBDeploymentProvider(provider)) {
			const wizard = new DeployAzureSQLDBWizard(this.notebookService, this.toolsService, resourceType, this);
			wizard.open();
		} else if (instanceOfWizardDeploymentProvider(provider)) {
			const wizard = new DeployClusterWizard(provider.bdcWizard, new KubeService(), new AzdataService(this.platformService), this.notebookService, this.toolsService, resourceType!, this);
			wizard.open();
		} else {
			const wizard = new NotebookWizard(this.notebookService, this.platformService, this.toolsService, resourceType, this);
			wizard.open();
		}
	}

	public startDeploymentFromWizard(provider: DeploymentProvider, resourceType?: ResourceType): void {
		const self = this;

		if (instanceOfWizardDeploymentProvider(provider)) {
			const wizard = new DeployClusterWizard(provider.bdcWizard, new KubeService(), new AzdataService(this.platformService), this.notebookService, this.toolsService, resourceType!, this);
			wizard.open();
		} else if (instanceOfDialogDeploymentProvider(provider)) {
			const dialog = new DeploymentInputDialog(this.notebookService, this.platformService, this.toolsService, provider.dialog);
			dialog.open();
		} else if (instanceOfNotebookDeploymentProvider(provider)) {
			this.notebookService.openNotebook(provider.notebook);
		} else if (instanceOfDownloadDeploymentProvider(provider)) {
			const taskName = localize('resourceDeployment.DownloadAndLaunchTaskName', "Download and launch installer, URL: {0}", provider.downloadUrl);
			azdata.tasks.startBackgroundOperation({
				displayName: taskName,
				description: taskName,
				isCancelable: false,
				operation: op => {
					op.updateStatus(azdata.TaskStatus.InProgress, localize('resourceDeployment.DownloadingText', "Downloading from: {0}", provider.downloadUrl));
					self.download(provider.downloadUrl).then(async (downloadedFile) => {
						op.updateStatus(azdata.TaskStatus.InProgress, localize('resourceDeployment.DownloadCompleteText', "Successfully downloaded: {0}", downloadedFile));
						op.updateStatus(azdata.TaskStatus.InProgress, localize('resourceDeployment.LaunchingProgramText', "Launching: {0}", downloadedFile));
						await this.platformService.runCommand(downloadedFile, { sudo: true });
						op.updateStatus(azdata.TaskStatus.Succeeded, localize('resourceDeployment.ProgramLaunchedText', "Successfully launched: {0}", downloadedFile));
					}, (error) => {
						op.updateStatus(azdata.TaskStatus.Failed, error);
					});
				}
			});
		} else if (instanceOfWebPageDeploymentProvider(provider)) {
			vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(provider.webPageUrl));
		} else if (instanceOfCommandDeploymentProvider(provider)) {
			vscode.commands.executeCommand(provider.command);
		}
	}

	private download(url: string): Promise<string> {
		const self = this;
		const promise = new Promise<string>((resolve, reject) => {
			https.get(url, async function (response) {
				console.log('Download installer from: ' + url);
				if (response.statusCode === 301 || response.statusCode === 302) {
					// Redirect and download from new location
					console.log('Redirecting the download to: ' + response.headers.location);
					self.download(response.headers.location!).then((result) => {
						resolve(result);
					}, (err) => {
						reject(err);
					});
					return;
				}
				if (response.statusCode !== 200) {
					reject(localize('downloadError', "Download failed, status code: {0}, message: {1}", response.statusCode, response.statusMessage));
					return;
				}
				const extension = path.extname(url);
				const originalFileName = path.basename(url, extension);
				let fileName = originalFileName;
				// Download it to the user's downloads folder
				// and fall back to the user's homedir if it does not exist.
				let downloadFolder = path.join(os.homedir(), 'Downloads');
				if (!await exists(downloadFolder)) {
					downloadFolder = os.homedir();
				}
				let cnt = 1;
				while (await exists(path.join(downloadFolder, fileName + extension))) {
					fileName = `${originalFileName}-${cnt}`;
					cnt++;
				}
				fileName = path.join(downloadFolder, fileName + extension);
				const file = createWriteStream(fileName);
				response.pipe(file);
				file.on('finish', () => {
					file.close();
					resolve(fileName);
				});
				file.on('error', async (err) => {
					await fs.unlink(fileName);
					reject(err.message);
				});
			});
		});
		return promise;
	}

}

async function exists(path: string): Promise<boolean> {
	try {
		await fs.access(path);
		return true;
	} catch (e) {
		return false;
	}
}

/**
 * processWhenClause takes in a when clause (either the word 'true' or a series of clauses in the format:
 * '<type_name>=<value_name>' joined by '&&').
 * If the when clause is true or undefined, return true as there is no clause to check.
 * It evaluates each individual when clause by comparing the equivalent selected options (sorted in alphabetical order and formatted to match).
 * If there is any selected option that doesn't match, return false.
 * Return true if all clauses match.
 */
export function processWhenClause(when: string | undefined, selectedOptions: { option: string, value: string }[]): boolean {
	if (when === undefined || when.toString().toLowerCase() === 'true') {
		return true;
	} else {
		const expected = when.replace(/\s/g, '').split('&&').sort();
		const actual = selectedOptions.map(option => `${option.option}=${option.value}`);
		for (let whenClause of expected) {
			if (actual.indexOf(whenClause) === -1) {
				return false;
			}
		}
		return true;
	}
}
