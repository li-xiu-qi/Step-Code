/** Staged attachments: `#attachButton`, `#attachInput`, `#attachmentList` (legacy app.js 2919-2985). */

import { type ChangeEvent, useRef } from "react";
import { useT } from "../../i18n";
import { useAppStore } from "../../state/store";
import type { Attachment } from "../../state/types";
import { Icon, IconButton } from "../../ui";
import { addAttachments, removeAttachment } from "./actions";

/**
 * Attachments carry no id (the API body is exactly the legacy shape), but the
 * store replaces the list without copying its entries, so each object is a
 * stable identity for the chip's React key.
 */
const chipKeys = new WeakMap<Attachment, number>();
let nextChipKey = 0;
function chipKey(attachment: Attachment): number {
	let key = chipKeys.get(attachment);
	if (key === undefined) {
		nextChipKey += 1;
		key = nextChipKey;
		chipKeys.set(attachment, key);
	}
	return key;
}

/** `#attachmentList`: one chip per staged file, hidden while there are none. */
export function AttachmentList() {
	const t = useT();
	const attachments = useAppStore((state) => state.attachments);
	return (
		<div className="attachment-list" id="attachmentList" hidden={!attachments.length}>
			{attachments.map((attachment, index) => (
				<span className="attachment-chip" key={chipKey(attachment)}>
					<span title={attachment.name}>{attachment.name}</span>
					<button
						type="button"
						title={t("removeAttachment")}
						aria-label={t("removeAttachment")}
						onClick={() => removeAttachment(index)}
					>
						<Icon name="close-sm" size="xs" />
					</button>
				</span>
			))}
		</div>
	);
}

/** `#attachButton` (hard-coded 添加附件, as legacy) and its hidden `#attachInput`. */
export function AttachControls() {
	const input = useRef<HTMLInputElement | null>(null);
	const onChange = (event: ChangeEvent<HTMLInputElement>) => {
		const files = [...(event.target.files ?? [])];
		// Reset so choosing the same file again still fires `change`.
		event.target.value = "";
		if (files.length) void addAttachments(files);
	};
	return (
		<>
			<IconButton
				id="attachButton"
				title="添加附件"
				aria-label="添加附件"
				icon="paperclip"
				onClick={() => input.current?.click()}
			/>
			<input type="file" id="attachInput" multiple hidden ref={input} onChange={onChange} />
		</>
	);
}
