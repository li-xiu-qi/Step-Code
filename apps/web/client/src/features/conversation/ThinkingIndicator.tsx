import { useT } from "../../i18n";
import { ShimmerText } from "../../ui";

/** The assistant row shown while a turn is under way and has nothing to show yet. */
export function ThinkingIndicator() {
	const t = useT();
	return (
		<output className="message assistant thinking-indicator">
			<ShimmerText>{t("thinkingIndicator")}</ShimmerText>
		</output>
	);
}
