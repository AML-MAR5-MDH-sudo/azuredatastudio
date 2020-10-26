/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { attachButtonStyler } from 'sql/platform/theme/common/styler';
import { Modal } from 'sql/workbench/browser/modal/modal';
import * as TelemetryKeys from 'sql/platform/telemetry/common/telemetryKeys';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { localize } from 'vs/nls';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import * as DOM from 'vs/base/browser/dom';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ILogService } from 'vs/platform/log/common/log';
import { ITextResourcePropertiesService } from 'vs/editor/common/services/textResourceConfigurationService';
import { IAdsTelemetryService } from 'sql/platform/telemetry/common/telemetry';
import { attachModalDialogStyler } from 'sql/workbench/common/styler';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { Deferred } from 'sql/base/common/promise';
import { InputBox } from 'sql/base/browser/ui/inputBox/inputBox';
import * as styler from 'vs/platform/theme/common/styler';
import { Button } from 'sql/base/browser/ui/button/button';
import { Checkbox } from 'sql/base/browser/ui/checkbox/checkbox';
import { RadioButton } from 'sql/base/browser/ui/radioButton/radioButton';

export type CalloutStyle = 'LINK' | 'IMAGE' | 'TABLE';

export interface ICalloutOptions {
	insertTtitle?: string,
	calloutStyle?: CalloutStyle,
	insertMarkup?: string,
	imagePath?: string,
	embedImage?: boolean
}

export class Callout extends Modal {
	private _calloutStyle: CalloutStyle;
	private _triggerCssSelector: string;
	private _container?: HTMLElement;

	private _selectionComplete: Deferred<ICalloutOptions>;
	private _insertButton: Button;
	private _cancelButton: Button;
	// Link
	private _linkTextLabel: HTMLElement;
	private _linkTextInputBox: InputBox;
	private _linkAddressLabel: HTMLElement;
	private _linkAddressInputBox: InputBox;
	// Image
	private _imageLocationLabel: HTMLElement;
	private _imageLocalRadioButton: RadioButton;
	private _imageRemoteRadioButton: RadioButton;
	private _imageUrlLabel: HTMLElement;
	private _imageUrlInputBox: InputBox;
	private _imageBrowseButton: HTMLAnchorElement;
	private _imageEmbedLabel: HTMLElement;
	private _imageEmbedCheckbox: Checkbox;

	private readonly insertButtonText = localize('callout.insertButton', "Insert");
	private readonly cancelButtonText = localize('callout.cancelButton', "Cancel");
	// Link
	private readonly linkTextLabel = localize('callout.linkTextLabel', "Text to display");
	private readonly linkTextPlaceholder = localize('callout.linkTextPlaceholder', "Text to display");
	private readonly linkAddressLabel = localize('callout.linkAddressLabel', "Address");
	private readonly linkAddressPlaceholder = localize('callout.linkAddressPlaceholder', "Link to an existing file or web page");
	// Image
	private readonly locationLabel = localize('callout.locationLabel', "Image location");
	private readonly localImageLabel = localize('callout.localImageLabel', "This computer");
	private readonly remoteImageLabel = localize('callout.remoteImageLabel', "Online");
	private readonly pathInputLabel = localize('callout.pathInputLabel', "Image URL");
	private readonly pathPlaceholder = localize('callout.pathPlaceholder', "Enter image URL");
	private readonly browseAltText = localize('callout.browseAltText', "Browse");
	private readonly embedImageLabel = localize('callout.embedImageLabel', "Attach image to notebook");

	constructor(
		calloutInstance: CalloutStyle,
		title: string,
		triggerCssSelector: string,
		@IThemeService themeService: IThemeService,
		@ILayoutService layoutService: ILayoutService,
		@IAdsTelemetryService telemetryService: IAdsTelemetryService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextViewService private contextViewService: IContextViewService,
		@IClipboardService clipboardService: IClipboardService,
		@ILogService logService: ILogService,
		@ITextResourcePropertiesService textResourcePropertiesService: ITextResourcePropertiesService
	) {
		super(
			localize('callout.title', "Insert {0}", title),
			TelemetryKeys.SelectImage,
			telemetryService,
			layoutService,
			clipboardService,
			themeService,
			logService,
			textResourcePropertiesService,
			contextKeyService,
			{
				dialogStyle: 'Callout',
				dialogPosition: 'below'
			});
		this._selectionComplete = new Deferred<ICalloutOptions>();
		this._calloutStyle = calloutInstance;
		this._triggerCssSelector = triggerCssSelector;
	}

	/**
	 * Opens the dialog and returns a promise for what options the user chooses.
	 */
	public open(): Promise<ICalloutOptions> {
		this.show();
		return this._selectionComplete.promise;
	}

	public render() {
		super.render();

		attachModalDialogStyler(this, this._themeService);

		this._insertButton = this.addFooterButton(this.insertButtonText, () => this.insert(this._calloutStyle));
		attachButtonStyler(this._insertButton, this._themeService);

		this._cancelButton = this.addFooterButton(this.cancelButtonText, () => this.cancel());
		attachButtonStyler(this._cancelButton, this._themeService);

		this.registerListeners();
	}

	protected renderBody(container: HTMLElement) {
		this._container = container;
		let description = DOM.$('.row');
		DOM.append(container, description);

		if (this._calloutStyle === 'IMAGE') {
			this._imageLocationLabel = DOM.$('.label');
			this._imageLocationLabel.innerText = this.locationLabel;
			DOM.append(description, this._imageLocationLabel);

			let radioButtonGroup = DOM.$('.radio-group');
			this._imageLocalRadioButton = new RadioButton(radioButtonGroup, {
				label: this.localImageLabel,
				enabled: true,
				checked: false,
			});
			this._imageRemoteRadioButton = new RadioButton(radioButtonGroup, {
				label: this.remoteImageLabel,
				enabled: true,
				checked: false
			});
			this._imageLocalRadioButton.value = 'local';
			this._imageLocalRadioButton.name = 'group1';
			this._imageRemoteRadioButton.value = 'remote';
			this._imageRemoteRadioButton.name = 'group1';
			DOM.append(description, radioButtonGroup);

			this._imageUrlLabel = DOM.$('.label');
			this._imageUrlLabel.innerText = this.pathInputLabel;
			DOM.append(description, this._imageUrlLabel);

			const inputContainer = DOM.$('.input-field');
			this._imageUrlInputBox = new InputBox(
				inputContainer,
				this.contextViewService,
				{
					placeholder: this.pathPlaceholder,
					ariaLabel: this.pathInputLabel
				});
			const browseButtonContainer = DOM.$('.button-icon');
			this._imageBrowseButton = DOM.$('a.notebook-button.codicon.masked-icon.browse-local');
			this._imageBrowseButton.title = this.browseAltText;
			DOM.append(inputContainer, browseButtonContainer);
			DOM.append(browseButtonContainer, this._imageBrowseButton);

			// this._imageBrowseButton.onclick(() => this.handleBrowse());

			DOM.append(description, inputContainer);

			this._imageEmbedLabel = DOM.append(description, DOM.$('.row'));
			this._imageEmbedCheckbox = new Checkbox(
				this._imageEmbedLabel,
				{
					label: this.embedImageLabel,
					checked: false,
					onChange: (viaKeyboard) => { },
					ariaLabel: this.embedImageLabel
				});
			DOM.append(description, this._imageEmbedLabel);
		}

		if (this._calloutStyle === 'LINK') {
			this._linkTextLabel = DOM.$('.label');
			this._linkTextLabel.innerText = this.linkTextLabel;
			DOM.append(description, this._linkTextLabel);

			const linkTextInputContainer = DOM.$('.input-field');
			this._linkTextInputBox = new InputBox(
				linkTextInputContainer,
				this.contextViewService,
				{
					placeholder: this.linkTextPlaceholder,
					ariaLabel: this.linkTextLabel
				});
			DOM.append(description, linkTextInputContainer);

			this._linkAddressLabel = DOM.$('.label');
			this._linkAddressLabel.innerText = this.linkAddressLabel;
			DOM.append(description, this._linkAddressLabel);

			const linkAddressInputContainer = DOM.$('.input-field');
			this._linkAddressInputBox = new InputBox(
				linkAddressInputContainer,
				this.contextViewService,
				{
					placeholder: this.linkAddressPlaceholder,
					ariaLabel: this.linkAddressLabel
				});
			DOM.append(description, linkAddressInputContainer);
		}

		// These are the values I need, but they need to be set somewhere else:
		let elTrigger = document.querySelector(this._triggerCssSelector).getBoundingClientRect();
		// this._container.style.position = 'absolute';
		// this._container.style.left = `${Math.round(elTrigger.x)}px`;
		// this._container.style.top = `${Math.round(elTrigger.top)}px`;
	}

	private registerListeners(): void {
		// Theme styler
		this._register(attachButtonStyler(this._insertButton, this._themeService));
		this._register(attachButtonStyler(this._cancelButton, this._themeService));
		if (this._calloutStyle === 'IMAGE') {
			this._register(styler.attachInputBoxStyler(this._imageUrlInputBox, this._themeService));
			this._register(styler.attachButtonStyler(this._imageEmbedCheckbox, this._themeService));
			this._register(styler.attachCheckboxStyler(this._imageEmbedCheckbox, this._themeService));
		}
		if (this._calloutStyle === 'LINK') {
			this._register(styler.attachInputBoxStyler(this._linkTextInputBox, this._themeService));
			this._register(styler.attachInputBoxStyler(this._linkAddressInputBox, this._themeService));
		}
	}

	protected layout(height?: number): void {
	}

	public insert(calloutStyle: string) {
		this.hide();
		if (calloutStyle === 'IMAGE') {
			this._selectionComplete.resolve({
				insertMarkup: `<img src="${this._imageUrlInputBox.value}">`,
				imagePath: this._imageUrlInputBox.value,
				embedImage: this._imageEmbedCheckbox.checked
			});
		}
		if (calloutStyle === 'LINK') {
			this._selectionComplete.resolve({
				insertMarkup: `<a href="${this._linkAddressInputBox.value}">${this._linkTextInputBox.value}</a>`,
			});
		}
	}

	public cancel() {
		this.hide();
		this._selectionComplete.resolve({
			insertMarkup: '',
			imagePath: undefined,
			embedImage: undefined
		});
	}

	// private handleBrowse(): void {
	// Todo: Find code used to browse file system ...
	//}

}
