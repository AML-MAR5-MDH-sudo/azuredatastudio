/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
declare module 'resource-deployment' {
	import * as azdata from 'azdata';

	export const enum ErrorType {
		userCancelled,
	}

	export interface ErrorWithType extends Error {
		readonly type: ErrorType;
	}

	export const enum extension {
		name = 'Microsoft.resource-deployment'
	}
	export interface IOptionsSourceProvider {
		readonly id: string,
		getOptions(): Promise<string[] | azdata.CategoryValue[]> | string[] | azdata.CategoryValue[];
		getVariableValue?: (variableName: string, input: string) => Promise<string> | string;
		getIsPassword?: (variableName: string) => boolean | Promise<boolean>;
	}

	export interface IValueProvider {
		readonly id: string,
		getValue(triggerValue: string): Promise<string>;
	}

	/**
	 * Covers defining what the resource-deployment extension exports to other extensions
	 *
	 * IMPORTANT: THIS IS NOT A HARD DEFINITION unlike vscode; therefore no enums or classes should be defined here
	 * (const enums get evaluated when typescript -> javascript so those are fine)
	 */

	export interface IExtension {
		registerOptionsSourceProvider(provider: IOptionsSourceProvider): void,
		registerValueProvider(provider: IValueProvider): void
	}
}
