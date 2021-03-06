/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as path from 'path';

import { languages, ExtensionContext, IndentAction, Position, TextDocument, Color, ColorInformation, ColorPresentation, TextEdit } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind, RequestType, TextDocumentPositionParams } from 'vscode-languageclient';
import { EMPTY_ELEMENTS } from './htmlEmptyTagsShared';
import { activateTagClosing } from './tagClosing';
import TelemetryReporter from 'vscode-extension-telemetry';
import * as convert from 'color-convert';

import { ConfigurationFeature } from 'vscode-languageclient/lib/proposed';
import { DocumentColorRequest } from 'vscode-languageserver-protocol/lib/protocol.colorProvider.proposed';

import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

namespace TagCloseRequest {
	export const type: RequestType<TextDocumentPositionParams, string, any, any> = new RequestType('html/tag');
}

interface IPackageInfo {
	name: string;
	version: string;
	aiKey: string;
}

export function activate(context: ExtensionContext) {
	let toDispose = context.subscriptions;

	let packageInfo = getPackageInfo(context);
	let telemetryReporter: TelemetryReporter = packageInfo && new TelemetryReporter(packageInfo.name, packageInfo.version, packageInfo.aiKey);
	if (telemetryReporter) {
		toDispose.push(telemetryReporter);
	}

	// The server is implemented in node
	let serverModule = context.asAbsolutePath(path.join('server', 'out', 'htmlServerMain.js'));
	// The debug options for the server
	let debugOptions = { execArgv: ['--nolazy', '--inspect=6004'] };

	// If the extension is launch in debug mode the debug server options are use
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
	};

	let documentSelector = ['html', 'handlebars', 'razor'];
	let embeddedLanguages = { css: true, javascript: true };

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		documentSelector,
		synchronize: {
			configurationSection: ['html', 'css', 'javascript'], // the settings to synchronize
		},
		initializationOptions: {
			embeddedLanguages
		}
	};

	// Create the language client and start the client.
	let client = new LanguageClient('html', localize('htmlserver.name', 'HTML Language Server'), serverOptions, clientOptions);
	client.registerFeature(new ConfigurationFeature(client));

	var _toTwoDigitHex = function (n: number): string {
		const r = n.toString(16);
		return r.length !== 2 ? '0' + r : r;
	};

	let disposable = client.start();
	toDispose.push(disposable);
	client.onReady().then(() => {
		disposable = languages.registerColorProvider(documentSelector, {
			provideDocumentColors(document: TextDocument): Thenable<ColorInformation[]> {
				let params = client.code2ProtocolConverter.asDocumentSymbolParams(document);
				return client.sendRequest(DocumentColorRequest.type, params).then(symbols => {
					return symbols.map(symbol => {
						let range = client.protocol2CodeConverter.asRange(symbol.range);
						let color = new Color(symbol.color.red, symbol.color.green, symbol.color.blue, symbol.color.alpha);
						return new ColorInformation(range, color);
					});
				});
			},
			provideColorPresentations(document: TextDocument, colorInfo: ColorInformation): ColorPresentation[] | Thenable<ColorPresentation[]> {
				let result: ColorPresentation[] = [];
				let color = colorInfo.color;
				let label;
				if (color.alpha === 1) {
					label = `rgb(${Math.round(color.red * 255)}, ${Math.round(color.green * 255)}, ${Math.round(color.blue * 255)})`;
				} else {
					label = `rgba(${Math.round(color.red * 255)}, ${Math.round(color.green * 255)}, ${Math.round(color.blue * 255)}, ${color.alpha})`;
				}

				result.push({ label: label, textEdit: new TextEdit(colorInfo.range, label) });

				if (color.alpha === 1) {
					label = `#${_toTwoDigitHex(Math.round(color.red * 255))}${_toTwoDigitHex(Math.round(color.green * 255))}${_toTwoDigitHex(Math.round(color.blue * 255))}`;
				} else {
					label = `#${_toTwoDigitHex(Math.round(color.red * 255))}${_toTwoDigitHex(Math.round(color.green * 255))}${_toTwoDigitHex(Math.round(color.blue * 255))}${_toTwoDigitHex(Math.round(color.alpha * 255))}`;
				}

				result.push({ label: label, textEdit: new TextEdit(colorInfo.range, label) });

				const hsl = convert.rgb.hsl(Math.round(color.red * 255), Math.round(color.green * 255), Math.round(color.blue * 255));
				if (color.alpha === 1) {
					label = `hsl(${hsl[0]}, ${hsl[1]}%, ${hsl[2]}%)`;
				} else {
					label = `hsla(${hsl[0]}, ${hsl[1]}%, ${hsl[2]}%, ${color.alpha})`;
				}

				result.push({ label: label, textEdit: new TextEdit(colorInfo.range, label) });
				return result;
			}
		});
		toDispose.push(disposable);

		let tagRequestor = (document: TextDocument, position: Position) => {
			let param = client.code2ProtocolConverter.asTextDocumentPositionParams(document, position);
			return client.sendRequest(TagCloseRequest.type, param);
		};
		disposable = activateTagClosing(tagRequestor, { html: true, handlebars: true, razor: true }, 'html.autoClosingTags');
		toDispose.push(disposable);

		disposable = client.onTelemetry(e => {
			if (telemetryReporter) {
				telemetryReporter.sendTelemetryEvent(e.key, e.data);
			}
		});
		toDispose.push(disposable);
	});

	languages.setLanguageConfiguration('html', {
		indentationRules: {
			increaseIndentPattern: /<(?!\?|(?:area|base|br|col|frame|hr|html|img|input|link|meta|param)\b|[^>]*\/>)([-_\.A-Za-z0-9]+)(?=\s|>)\b[^>]*>(?!.*<\/\1>)|<!--(?!.*-->)|\{[^}"']*$/,
			decreaseIndentPattern: /^\s*(<\/(?!html)[-_\.A-Za-z0-9]+\b[^>]*>|-->|\})/
		},
		wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\$\^\&\*\(\)\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\s]+)/g,
		onEnterRules: [
			{
				beforeText: new RegExp(`<(?!(?:${EMPTY_ELEMENTS.join('|')}))([_:\\w][_:\\w-.\\d]*)([^/>]*(?!/)>)[^<]*$`, 'i'),
				afterText: /^<\/([_:\w][_:\w-.\d]*)\s*>$/i,
				action: { indentAction: IndentAction.IndentOutdent }
			},
			{
				beforeText: new RegExp(`<(?!(?:${EMPTY_ELEMENTS.join('|')}))(\\w[\\w\\d]*)([^/>]*(?!/)>)[^<]*$`, 'i'),
				action: { indentAction: IndentAction.Indent }
			}
		],
	});

	languages.setLanguageConfiguration('handlebars', {
		wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\$\^\&\*\(\)\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\s]+)/g,
		onEnterRules: [
			{
				beforeText: new RegExp(`<(?!(?:${EMPTY_ELEMENTS.join('|')}))([_:\\w][_:\\w-.\\d]*)([^/>]*(?!/)>)[^<]*$`, 'i'),
				afterText: /^<\/([_:\w][_:\w-.\d]*)\s*>$/i,
				action: { indentAction: IndentAction.IndentOutdent }
			},
			{
				beforeText: new RegExp(`<(?!(?:${EMPTY_ELEMENTS.join('|')}))(\\w[\\w\\d]*)([^/>]*(?!/)>)[^<]*$`, 'i'),
				action: { indentAction: IndentAction.Indent }
			}
		],
	});

	languages.setLanguageConfiguration('razor', {
		wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\$\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\s]+)/g,
		onEnterRules: [
			{
				beforeText: new RegExp(`<(?!(?:${EMPTY_ELEMENTS.join('|')}))([_:\\w][_:\\w-.\\d]*)([^/>]*(?!/)>)[^<]*$`, 'i'),
				afterText: /^<\/([_:\w][_:\w-.\d]*)\s*>$/i,
				action: { indentAction: IndentAction.IndentOutdent }
			},
			{
				beforeText: new RegExp(`<(?!(?:${EMPTY_ELEMENTS.join('|')}))(\\w[\\w\\d]*)([^/>]*(?!/)>)[^<]*$`, 'i'),
				action: { indentAction: IndentAction.Indent }
			}
		],
	});
}

function getPackageInfo(context: ExtensionContext): IPackageInfo {
	let extensionPackage = require(context.asAbsolutePath('./package.json'));
	if (extensionPackage) {
		return {
			name: extensionPackage.name,
			version: extensionPackage.version,
			aiKey: extensionPackage.aiKey
		};
	}
	return null;
}