// Service layer — domain logic, single-responsibility modules.
export { explainTrackers, generateExecutiveSummary, generateHtmlReport, scanWebsite } from './web-scanner';
export type { BrowserData, CategoryResult, Finding, ScanResult, Severity } from './web-scanner';
