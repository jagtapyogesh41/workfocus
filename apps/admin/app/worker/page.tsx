import type { Metadata } from 'next';
import WorkerMobileApp from './WorkerMobileApp';
import { DEFAULT_KEYWORDS, SITE_NAME, SITE_URL } from '../seo';

export const metadata: Metadata = {
  title: 'Employee Mobile App (PWA) — Shift Status & Emergency Override',
  description:
    'Installable ShiftFocus Employee Mobile App. View live shift focus status, see allowed essential apps (Phone, SMS, WhatsApp), and trigger a 1-tap Emergency Override anytime.',
  keywords: [
    ...DEFAULT_KEYWORDS,
    'employee shift focus app',
    'worker mobile PWA',
    '1-tap emergency override',
    'shift app status',
  ],
  alternates: {
    canonical: '/worker',
  },
  openGraph: {
    title: 'ShiftFocus Employee Mobile App (PWA)',
    description:
      'Check your active shift focus status, allowed communication apps, and 1-tap emergency override on Android and iOS.',
    url: `${SITE_URL}/worker`,
    siteName: SITE_NAME,
    type: 'website',
  },
};

const workerAppJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'ShiftFocus Employee Mobile App',
  applicationCategory: 'UtilitiesApplication',
  operatingSystem: 'Android, iOS, Web',
  url: `${SITE_URL}/worker`,
  description:
    'Installable Progressive Web App for employees to view shift focus mode, allowed apps, and trigger immediate emergency overrides.',
};

export default function WorkerPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(workerAppJsonLd) }}
      />
      <WorkerMobileApp />
    </>
  );
}
