"use strict";

window.addEventListener("DOMContentLoaded", async () => {
	// 各要素を把握する
	const fontSelector = document.getElementById("fontSelector");
	const textField = document.getElementById("textField");
	const saveButton = document.getElementById("saveButton");
	const noUpdateCheck = document.getElementById("noUpdateCheck");
	const outputCanvasWrapper = document.getElementById("outputCanvasWrapper");
	const outputCanvas = document.getElementById("outputCanvas");

	// フォントリストを読み込む
	const fontsInfoResponse = await fetch("fonts.json");
	if (!fontsInfoResponse.ok) {
		throw "font information load failed with status " + fontsInfoResponse.status;
	}
	const fontsInfo = await fontsInfoResponse.json();
	const fontGroups = new Map();
	fontsInfo.groups.forEach((groupInfo) => {
		if (fontGroups.has(groupInfo.id)) {
			console.warn("ignoring duplicate group id: " + groupInfo.id);
		} else {
			const optgroup = document.createElement("optgroup");
			optgroup.setAttribute("label", groupInfo.name);
			fontSelector.appendChild(optgroup);
			fontGroups.set(groupInfo.id, optgroup);
		}
	});
	const fonts = new Map();
	fontsInfo.fonts.forEach((fontInfo) => {
		if (fonts.has(fontInfo.id)) {
			console.warn("ignoring duplicate font id: " + fontInfo.id);
		} else {
			const option = document.createElement("option");
			option.setAttribute("value", fontInfo.id);
			option.appendChild(document.createTextNode(fontInfo.name));
			if (!("group" in fontInfo) || !fontGroups.has(fontInfo.group)) {
				fontSelector.appendChild(option);
			} else {
				fontGroups.get(fontInfo.group).appendChild(option);
			}
			fonts.set(fontInfo.id, fontInfo);
		}
	});

	// 画像読み込みの準備を行う
	const imageCache = new Map();
	const loadImage = async (file) => {
		if (imageCache.has(file)) {
			return imageCache.get(file);
		}
		return new Promise((resolve, reject) => {
			const img = document.createElement("img");
			img.onload = () => {
				imageCache.set(file, img);
				resolve(img);
			};
			img.onerror = (error) => {
				console.warn("failed to load image \"" + file + "\"", error);
				imageCache.set(file, null);
				resolve(null);
			};
			img.src = file;
		});
	};

	// 文字から座標に変換するテーブルを作成する
	const chars = new Map();
	const decoder = new TextDecoder("shift_jis", { fatal: true });
	for (let one = 0x81; one <= 0xef; one++) {
		if (one === 0xa0) one = 0xe0;
		for (let two = 0x40; two <= 0xfc; two++) {
			if (two === 0x7f) continue;
			let y = 2 * (one - 0x81 - (one >= 0xe0 ? 0x40 : 0)) + (two >= 0x9f ? 1 : 0);
			let x = (two - 0x40 - (two >= 0x80 ? 1 : 0)) % 94;
			try {
				const decoded = decoder.decode(new Uint8Array([one, two]));
				if (!chars.has(decoded)) {
					chars.set(decoded, {"type": "zen", "x": x, "y": y});
				}
			} catch (e) {}
		}
	}
	for (let c = 0x20; c <= 0xdf; c++) {
		if (c === 0x7f) c = 0xa1;
		try {
			const decoded = decoder.decode(new Uint8Array([c]));
			if (!chars.has(decoded)) {
				chars.set(decoded, {"type": "han", "x": c % 16, "y": c >> 4});
			}
		} catch (e) {}
	}
	// 似た文字で一方しか登録されていないものにエイリアスをつける
	const addAlias = (a, b) => {
		if (chars.has(a) && !chars.has(b)) {
			chars.set(b, chars.get(a));
		} else if (chars.has(b) && !chars.has(a)) {
			chars.set(a, chars.get(b));
		}
	};
	addAlias("\u301c", "\uff5e"); // 波ダッシュ・全角チルダ
	addAlias("\u005c", "\u00a5"); // バックスラッシュ・円マーク
	addAlias("\u203e", "\uffe3"); // オーバーライン・全角オーバーライン

	// 文字列を文字の配列に変換する (サロゲートペア考慮)
	const strToChars = (str) => {
		const result = [];
		for (let i = 0; i < str.length; i++) {
			const c = str.charCodeAt(i);
			const c2 = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
			if (0xd800 <= c && c <= 0xdbff && 0xdc00 <= c2 && c2 <= 0xdfff) {
				result.push(str.substring(i, i + 2));
				i++;
			} else {
				result.push(str.charAt(i));
			}
		}
		return result;
	};

	// テキストを画像化する関数
	const unknownCharStyle = "#FF8080";
	const fontLoadErrorStyle = "#FFFF80";
	const fillerStyle = "#C0C0C0";
	const tabStyle = "#FFFFFF";
	const tabStop = 4;
	const renderWaits = [];
	const render = async () => {
		// 一度に1個ずつ実行させる
		if (renderWaits.length === 0) {
			renderWaits.push(() => {});
		} else {
			await new Promise((resolve) => {
				renderWaits.push(resolve);
			});
		}

		try {
			const font = fonts.get(fontSelector.value);
			if (!font) return;
			const textLines = textField.value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n$/, "").split("\n").map(strToChars);
			const height = font.height * textLines.length;
			let width = 1;
			textLines.forEach((line) => {
				let lineWidth = 0;
				line.forEach((c) => {
					if (c === "\t") {
						const tabWidth = font.hanWidth * tabStop;
						lineWidth += tabWidth - lineWidth % tabWidth;
					} else {
						lineWidth += chars.has(c) && chars.get(c).type === "han" ? font.hanWidth : font.zenWidth;
					}
				});
				if (width < lineWidth) width = lineWidth;
			});
			const oldWidth = outputCanvas.width, oldHeight = outputCanvas.height;
			outputCanvas.setAttribute("width", width);
			outputCanvas.setAttribute("height", height);
			outputCanvasWrapper.style.width = (width * 2) + "px";
			outputCanvasWrapper.style.height = (height * 2) + "px";
			const ctx = outputCanvas.getContext("2d", {"alpha": false});
			if (oldWidth !== width || oldHeight !== height) {
				ctx.fillStyle = fillerStyle;
				ctx.fillRect(0, 0, width, height);
			}
			for (let y = 0; y < textLines.length; y++) {
				const line = textLines[y];
				let x = 0;
				for (let i = 0; i < line.length; i++) {
					const c = line[i];
					if (c === "\t") {
						const tabWidth = font.hanWidth * tabStop;
						const drawWidth = tabWidth - x % tabWidth;
						ctx.fillStyle = tabStyle;
						ctx.fillRect(x, font.height * y, drawWidth, font.height);
						x += drawWidth;
					} else if (chars.has(c)) {
						const charInfo = chars.get(c);
						const img = await loadImage(charInfo.type === "han" ? font.hanFile : font.zenFile);
						const drawWidth = charInfo.type === "han" ? font.hanWidth : font.zenWidth;
						if (img) {
							ctx.drawImage(img, drawWidth * charInfo.x, font.height * charInfo.y, drawWidth, font.height, x, font.height * y, drawWidth, font.height);
						} else {
							ctx.fillStyle = fontLoadErrorStyle;
							ctx.fillRect(x, font.height * y, drawWidth, font.height);
						}
						x += drawWidth;
					} else {
						ctx.fillStyle = unknownCharStyle;
						ctx.fillRect(x, font.height * y, font.zenWidth, font.height);
						x += font.zenWidth;
					}
				}
				if (x < width) {
					 ctx.fillStyle = fillerStyle;
					 ctx.fillRect(x, font.height * y, width - x, font.height);
				}
			}
		} catch (e) {
			console.error(e);
		}

		// 待機中の次の実行を実行させる
		renderWaits.shift();
		if (renderWaits.length > 0) renderWaits[0](true);
	};

	// フォント選択を保存する用
	const fontSelectKey = "misaki_picker-1a394857-ee1a-4555-bef5-291f7a403381-font-select";
	// フォント選択を読み込む
	let fontSelectedFromLocalStorage = false;
	if (window.localStorage) {
		try {
			const selectedFont = window.localStorage.getItem(fontSelectKey);
			if (selectedFont !== null) {
				for (let i = 0; i < fontSelector.options.length; i++) {
					if (fontSelector.options[i].value === selectedFont) {
						fontSelector.selectedIndex = i;
						fontSelectedFromLocalStorage = true;
						break;
					}
				}
			}
		} catch (e) {}
	}
	if (!fontSelectedFromLocalStorage) {
		for (let i = 0; i < fontSelector.options.length; i++) {
			if (fontSelector.options[i].value === fontsInfo.defaultFont) {
				fontSelector.selectedIndex = i;
				break;
			}
		}
	}

	// イベントハンドラを設定する
	let pendingUpdate = false;
	fontSelector.addEventListener("change", () => {
		if (noUpdateCheck.checked) {
			pendingUpdate = true;
		} else {
			pendingUpdate = false;
			render();
		}
		if (window.localStorage) {
			try {
				window.localStorage.setItem(fontSelectKey, fontSelector.value);
			} catch (e) {}
		}
	});
	textField.addEventListener("input", () => {
		if (noUpdateCheck.checked) {
			pendingUpdate = true;
		} else {
			pendingUpdate = false;
			render();
		}
	});
	noUpdateCheck.addEventListener("change", () => {
		if (!noUpdateCheck.checked && pendingUpdate) {
			pendingUpdate = false;
			render();
		}
	});
	saveButton.addEventListener("click", () => {
		outputCanvas.toBlob((blob) => {
			if (blob) {
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.setAttribute("href", url);
				a.setAttribute("download", "image.png");
				a.click();
				URL.revokeObjectURL(url);
			}
		});
	});

	// UIの無効化を解除する
	fontSelector.disabled = false;
	textField.disabled = false;
	saveButton.disabled = false;
	noUpdateCheck.disabled = false;

	// 描画を実行する
	render();
});
