/**
 * Building blocks shared by the settings pages: page header, cards and rows,
 * section headings, empty states, a labelled select and status badges. Class
 * names are global (`settings-*`) and styled in settings.css.
 */

import { type ReactNode, useId } from "react";
import { cx } from "../../lib/format";
import { Icon, type IconName, Spinner } from "../../ui";

export function PageHeader({
	title,
	description,
	actions,
}: {
	readonly title: string;
	readonly description?: ReactNode;
	readonly actions?: ReactNode;
}) {
	return (
		<header className="settings-page-header">
			<div>
				<h1 className="settings-page-title">{title}</h1>
				{description ? <p className="settings-page-desc">{description}</p> : null}
			</div>
			{actions ? <div className="settings-page-actions">{actions}</div> : null}
		</header>
	);
}

export function SectionHeader({
	title,
	count,
	hint,
	actions,
}: {
	readonly title: string;
	readonly count?: number;
	readonly hint?: ReactNode;
	readonly actions?: ReactNode;
}) {
	return (
		<div className="settings-section-header">
			<div className="settings-section-heading">
				<h2>
					{title}
					{count !== undefined ? <span className="settings-count">{count}</span> : null}
				</h2>
				{hint ? <p>{hint}</p> : null}
			</div>
			{actions ? <div className="settings-section-actions">{actions}</div> : null}
		</div>
	);
}

export function SettingsCard({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
	return <div className={cx("settings-card", className)}>{children}</div>;
}

/** Title and description on the left, the control on the right. */
export function SettingRow({
	title,
	description,
	control,
	labelFor,
}: {
	readonly title: string;
	readonly description?: ReactNode;
	readonly control: ReactNode;
	/** id of the control the title labels. */
	readonly labelFor?: string;
}) {
	return (
		<div className="settings-row">
			<div className="settings-row-text">
				{labelFor ? (
					<label className="settings-row-title" htmlFor={labelFor}>
						{title}
					</label>
				) : (
					<div className="settings-row-title">{title}</div>
				)}
				{description ? <div className="settings-row-desc">{description}</div> : null}
			</div>
			<div className="settings-row-control">{control}</div>
		</div>
	);
}

export function EmptyBox({
	icon,
	title,
	hint,
	actions,
}: {
	readonly icon: IconName;
	readonly title: string;
	readonly hint?: string;
	readonly actions?: ReactNode;
}) {
	return (
		<div className="settings-empty">
			<span className="settings-empty-icon">
				<Icon name={icon} size="lg" />
			</span>
			<strong>{title}</strong>
			{hint ? <p>{hint}</p> : null}
			{actions ? <div className="settings-empty-actions">{actions}</div> : null}
		</div>
	);
}

/** Loading, error and empty-list states of a fetched list, in one place. */
export function ResourceState({
	loading,
	error,
	hasData,
	loadingLabel,
}: {
	readonly loading: boolean;
	readonly error: string | undefined;
	readonly hasData: boolean;
	readonly loadingLabel: string;
}) {
	if (error) {
		return (
			<div className="settings-alert danger" role="alert">
				{error}
			</div>
		);
	}
	if (loading && !hasData) {
		return (
			<div className="settings-loading">
				<Spinner />
				<span>{loadingLabel}</span>
			</div>
		);
	}
	return null;
}

export interface SelectOption<T extends string> {
	readonly value: T;
	readonly label: string;
}

/** Native `<select>` with the settings look: keyboard and screen readers behave as usual. */
export function SettingsSelect<T extends string>({
	id,
	value,
	options,
	onChange,
	ariaLabel,
	className,
}: {
	readonly id?: string;
	readonly value: T;
	readonly options: ReadonlyArray<SelectOption<T>>;
	readonly onChange: (value: T) => void;
	readonly ariaLabel?: string;
	readonly className?: string;
}) {
	const fallbackId = useId();
	return (
		<span className={cx("settings-select", className)}>
			<select
				id={id ?? fallbackId}
				value={value}
				aria-label={ariaLabel}
				onChange={(event) => onChange(event.target.value as T)}
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
			<Icon name="chevronDown" size="xs" />
		</span>
	);
}

export function Badge({
	children,
	tone = "neutral",
}: {
	readonly children: ReactNode;
	readonly tone?: "neutral" | "success" | "danger" | "attention";
}) {
	return <span className={cx("settings-badge", tone !== "neutral" && tone)}>{children}</span>;
}

/** Coloured dot plus label for an MCP connection state. */
export function StatusDot({ tone, label }: { readonly tone: string; readonly label: string }) {
	return (
		<span className={cx("settings-status", tone)}>
			<i />
			{label}
		</span>
	);
}
