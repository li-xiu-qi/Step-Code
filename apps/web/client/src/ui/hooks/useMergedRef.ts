import { type Ref, type RefCallback, useCallback } from "react";

function assignRef<T>(ref: Ref<T> | undefined, node: T | null): void {
	if (typeof ref === "function") ref(node);
	else if (ref) (ref as { current: T | null }).current = node;
}

/** One ref callback that feeds both given refs (object or callback), e.g. a component's own ref and a forwarded one. */
export function useMergedRef<T>(first: Ref<T> | undefined, second: Ref<T> | undefined): RefCallback<T> {
	return useCallback(
		(node: T | null) => {
			assignRef(first, node);
			assignRef(second, node);
		},
		[first, second],
	);
}
