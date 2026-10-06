// Small inline icons for buttons (stroke icons, inherit text colour).
const base = { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
const I = (paths, cls = "h-4 w-4") => function Icon({ className = cls }) { return <svg {...base} className={className}>{paths}</svg>; };

export const PlayIcon = I(<path d="M6 4l14 8-14 8V4z" />);
export const StopIcon = I(<rect x="6" y="6" width="12" height="12" rx="1" />);
export const RefreshIcon = I(<><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></>);
export const DownloadIcon = I(<><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 19h16" /></>);
export const TrashIcon = I(<><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></>);
export const ChevronDownIcon = I(<path d="M6 9l6 6 6-6" />);
export const ChevronUpIcon = I(<path d="M6 15l6-6 6 6" />);
export const CloseIcon = I(<><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>);
export const ExternalIcon = I(<><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>, "h-3.5 w-3.5");
export const CopyIcon = I(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h10" /></>, "h-3.5 w-3.5");
export const FileIcon = I(<><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5" /></>);
export const FlagIcon = I(<><path d="M5 21V4" /><path d="M5 4h12l-2 4 2 4H5" /></>, "h-3.5 w-3.5");
export const CheckIcon = I(<path d="M5 12l5 5L20 7" />);
export const MailIcon = I(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>);
export const SearchIcon = I(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>);
export function SpinnerIcon({ className = "h-4 w-4" }) {
  return <svg {...base} className={`animate-spin ${className}`}><path d="M21 12a9 9 0 1 1-6.2-8.56" /></svg>;
}
export const InfoIcon = I(<><circle cx="12" cy="12" r="9" /><path d="M12 8h.01" /><path d="M11 12h1v4h1" /></>, "h-3.5 w-3.5");
export const ArchiveIcon = I(<><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></>);
