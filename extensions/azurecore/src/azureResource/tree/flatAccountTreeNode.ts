/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as azdata from 'azdata';
import { TokenCredentials } from '@azure/ms-rest-js';

import * as nls from 'vscode-nls';
const localize = nls.loadMessageBundle();

import { AppContext } from '../../appContext';
import { azureResource } from 'azureResource';
import { TreeNode } from '../treeNode';
import { AzureResourceCredentialError } from '../errors';
import { AzureResourceContainerTreeNodeBase } from './baseTreeNodes';
import { AzureResourceItemType, AzureResourceServiceNames } from '../constants';
import { AzureResourceMessageTreeNode } from '../messageTreeNode';
import { IAzureResourceTreeChangeHandler } from './treeChangeHandler';
import { IAzureResourceSubscriptionService, IAzureResourceSubscriptionFilterService } from '../../azureResource/interfaces';
import { AzureAccount } from '../../account-provider/interfaces';
import { AzureResourceService } from '../resourceService';
import { AzureResourceResourceTreeNode } from '../resourceTreeNode';
import { AzureResourceErrorMessageUtil } from '../utils';

export class FlatAccountTreeNode extends AzureResourceContainerTreeNodeBase {
	public constructor(
		public readonly account: AzureAccount,
		appContext: AppContext,
		treeChangeHandler: IAzureResourceTreeChangeHandler
	) {
		super(appContext, treeChangeHandler, undefined);

		this._subscriptionService = this.appContext.getService<IAzureResourceSubscriptionService>(AzureResourceServiceNames.subscriptionService);
		this._subscriptionFilterService = this.appContext.getService<IAzureResourceSubscriptionFilterService>(AzureResourceServiceNames.subscriptionFilterService);
		this._resourceService = this.appContext.getService<AzureResourceService>(AzureResourceServiceNames.resourceService);

		this._id = `account_${this.account.key.accountId}`;
		this.setCacheKey(`${this._id}.dataresources`);
		this._label = account.displayInfo.displayName;
		this._loader = new FlatAccountTreeNodeLoader(appContext, this._resourceService, this._subscriptionService, this._subscriptionFilterService, this.account, this);
		this._loader.onNewResourcesAvailable(() => {
			this.treeChangeHandler.notifyNodeChanged(this);
		});

		this._loader.onLoadingStatusChanged(async () => {
			await this.updateLabel();
			this.treeChangeHandler.notifyNodeChanged(this);
		});
	}

	public async updateLabel(): Promise<void> {
		const subscriptionInfo = await getSubscriptionInfo(this.account, this._subscriptionService, this._subscriptionFilterService);
		if (this._loader.isLoading) {
			this._label = localize('azure.resource.tree.accountTreeNode.titleLoading', "{0} - Loading...", this.account.displayInfo.displayName);
		} else if (subscriptionInfo.total !== 0) {
			this._label = localize({
				key: 'azure.resource.tree.accountTreeNode.title',
				comment: [
					'{0} is the display name of the azure account',
					'{1} is the number of selected subscriptions in this account',
					'{2} is the number of total subscriptions in this account'
				]
			}, "{0} ({1}/{2} subscriptions)", this.account.displayInfo.displayName, subscriptionInfo.selected, subscriptionInfo.total);
		} else {
			this._label = this.account.displayInfo.displayName;
		}
	}

	public async getChildren(): Promise<TreeNode[]> {
		if (this._isClearingCache) {
			this._loader.start();
			this._isClearingCache = false;
			return [];
		} else {
			return this._loader.nodes;
		}
	}

	public getTreeItem(): vscode.TreeItem | Promise<vscode.TreeItem> {
		const item = new vscode.TreeItem(this._label, vscode.TreeItemCollapsibleState.Collapsed);
		item.id = this._id;
		item.contextValue = AzureResourceItemType.account;
		item.iconPath = {
			dark: this.appContext.extensionContext.asAbsolutePath('resources/dark/account_inverse.svg'),
			light: this.appContext.extensionContext.asAbsolutePath('resources/light/account.svg')
		};
		return item;
	}

	public getNodeInfo(): azdata.NodeInfo {
		return {
			label: this._label,
			isLeaf: false,
			errorMessage: undefined,
			metadata: undefined,
			nodePath: this.generateNodePath(),
			nodeStatus: undefined,
			nodeType: AzureResourceItemType.account,
			nodeSubType: undefined,
			iconType: AzureResourceItemType.account
		};
	}

	public get nodePathValue(): string {
		return this._id;
	}

	private _subscriptionService: IAzureResourceSubscriptionService;
	private _subscriptionFilterService: IAzureResourceSubscriptionFilterService;
	private _resourceService: AzureResourceService;
	private _loader: FlatAccountTreeNodeLoader;
	private _id: string;
	private _label: string;
}

async function getSubscriptionInfo(account: AzureAccount, subscriptionService: IAzureResourceSubscriptionService, subscriptionFilterService: IAzureResourceSubscriptionFilterService): Promise<{
	subscriptions: azureResource.AzureResourceSubscription[],
	total: number,
	selected: number
}> {
	let subscriptions: azureResource.AzureResourceSubscription[] = [];
	try {
		for (const tenant of account.properties.tenants) {
			const token = await azdata.accounts.getAccountSecurityToken(account, tenant.id, azdata.AzureResource.ResourceManagement);
			subscriptions.push(...(await subscriptionService.getSubscriptions(account, new TokenCredentials(token.token, token.tokenType), tenant.id) || <azureResource.AzureResourceSubscription[]>[]));
		}
	} catch (error) {
		throw new AzureResourceCredentialError(localize('azure.resource.tree.accountTreeNode.credentialError', "Failed to get credential for account {0}. Please refresh the account.", account.key.accountId), error);
	}
	const total = subscriptions.length;
	let selected = total;

	const selectedSubscriptions = await subscriptionFilterService.getSelectedSubscriptions(account);
	const selectedSubscriptionIds = (selectedSubscriptions || <azureResource.AzureResourceSubscription[]>[]).map((subscription) => subscription.id);
	if (selectedSubscriptionIds.length > 0) {
		subscriptions = subscriptions.filter((subscription) => selectedSubscriptionIds.indexOf(subscription.id) !== -1);
		selected = selectedSubscriptionIds.length;
	}
	return {
		subscriptions,
		total,
		selected
	};
}
class FlatAccountTreeNodeLoader {

	private _isLoading: boolean = false;
	private _nodes: TreeNode[];
	private readonly _onNewResourcesAvailable = new vscode.EventEmitter<void>();
	public readonly onNewResourcesAvailable = this._onNewResourcesAvailable.event;
	private readonly _onLoadingStatusChanged = new vscode.EventEmitter<void>();
	public readonly onLoadingStatusChanged = this._onLoadingStatusChanged.event;

	constructor(private readonly appContext: AppContext,
		private readonly _resourceService: AzureResourceService,
		private readonly _subscriptionService: IAzureResourceSubscriptionService,
		private readonly _subscriptionFilterService: IAzureResourceSubscriptionFilterService,
		private readonly _account: AzureAccount,
		private readonly _accountNode: TreeNode) {
	}

	public get isLoading(): boolean {
		return this._isLoading;
	}

	public get nodes(): TreeNode[] {
		return this._nodes;
	}

	public async start(): Promise<void> {
		if (this._isLoading) {
			return;
		}
		this._isLoading = true;
		this._nodes = [];
		this._onLoadingStatusChanged.fire();
		let newNodesAvailable = false;

		// Throttle the refresh events to at most once per 500ms
		const refreshHandle = setInterval(() => {
			if (newNodesAvailable) {
				this._onNewResourcesAvailable.fire();
				newNodesAvailable = false;
			}
			if (!this.isLoading) {
				clearInterval(refreshHandle);
			}
		}, 500);
		try {
			let subscriptions: azureResource.AzureResourceSubscription[] = (await getSubscriptionInfo(this._account, this._subscriptionService, this._subscriptionFilterService)).subscriptions;

			if (subscriptions.length !== 0) {
				// Filter out everything that we can't authenticate to.
				subscriptions = subscriptions.filter(async s => {
					const token = await azdata.accounts.getAccountSecurityToken(this._account, s.tenant, azdata.AzureResource.ResourceManagement);
					if (!token) {
						console.info(`Account does not have permissions to view subscription ${JSON.stringify(s)}.`);
						return false;
					}
					return true;
				});
			}

			const resourceProviderIds = await this._resourceService.listResourceProviderIds();
			for (const subscription of subscriptions) {
				for (const providerId of resourceProviderIds) {
					const resourceTypes = await this._resourceService.getRootChildren(providerId, this._account, subscription, subscription.tenant);
					for (const resourceType of resourceTypes) {
						const resources = await this._resourceService.getChildren(providerId, resourceType.resourceNode, true);
						if (resources.length > 0) {
							this._nodes.push(...resources.map(dr => new AzureResourceResourceTreeNode(dr, this._accountNode, this.appContext)));
							this._nodes = this.nodes.sort((a, b) => {
								return a.getNodeInfo().label.localeCompare(b.getNodeInfo().label);
							});
							newNodesAvailable = true;
						}
					}
				}
			}
		} catch (error) {
			if (error instanceof AzureResourceCredentialError) {
				vscode.commands.executeCommand('azure.resource.signin');
			}
			this._nodes = [AzureResourceMessageTreeNode.create(AzureResourceErrorMessageUtil.getErrorMessage(error), this._accountNode)];
		}

		this._isLoading = false;
		this._onLoadingStatusChanged.fire();
	}
}
