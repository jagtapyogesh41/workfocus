import type { Metadata } from 'next';
import ShiftFocusConsole from './ShiftFocusConsole';
import { DEFAULT_KEYWORDS, SITE_NAME, SITE_URL } from './seo';

export const metadata: Metadata = {
  title: 'Attendance-Linked Workplace Focus Software',
  description:
    'ShiftFocus connects biometric and HR attendance punches to Android Enterprise focus policies. Pause social & short-video apps on clock-in while keeping Phone, SMS, and WhatsApp open.',
  keywords: [
    ...DEFAULT_KEYWORDS,
    'workplace focus console',
    'shift attendance app control',
    'factory floor mobile policy',
  ],
  alternates: {
    canonical: '/',
    languages: {
      en: '/',
      'x-default': '/',
    },
  },
  openGraph: {
    title: 'ShiftFocus — Attendance-Linked Workplace Focus Console',
    description:
      'Live pilot console and gate attendance simulator for industrial workplace focus management.',
    url: `${SITE_URL}/`,
    siteName: SITE_NAME,
    type: 'website',
  },
};

const softwareJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'ShiftFocus',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web, Android, iOS',
  url: SITE_URL,
  description:
    'Attendance-linked focus management system for industrial workplaces that pauses distracting social and video apps during active shifts while keeping essential communication open.',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
      />
      <ShiftFocusConsole />
    </>
  );
}
