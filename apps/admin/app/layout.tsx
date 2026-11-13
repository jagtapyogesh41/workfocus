import './globals.css';
import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { DEFAULT_KEYWORDS, SITE_NAME, SITE_URL } from './seo';

const googleVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION;
const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: {
    default: 'ShiftFocus — Attendance-Linked Workplace Focus Software',
    template: `%s | ${SITE_NAME}`,
  },
  description:
    'Attendance-linked focus management for industrial workplaces. Automatically pause distracting social and video apps on clock-in while keeping Phone, SMS, and WhatsApp always available.',
  keywords: DEFAULT_KEYWORDS,
  authors: [{ name: 'ShiftFocus' }],
  creator: 'ShiftFocus',
  publisher: 'ShiftFocus',
  alternates: {
    canonical: '/',
    languages: {
      en: '/',
      'x-default': '/',
    },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-snippet': -1,
      'max-image-preview': 'large',
      'max-video-preview': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: 'ShiftFocus — Attendance-Linked Workplace Focus Software',
    description:
      'Connect biometric and HR attendance punches to Android Enterprise focus policies. Pause social & short-video apps during shifts with 1-tap emergency override.',
    images: [
      {
        url: '/icon-512.png',
        width: 512,
        height: 512,
        alt: 'ShiftFocus — Attendance-Linked Workplace Focus Management',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'ShiftFocus — Attendance-Linked Workplace Focus Management',
    description:
      'Pause distracting social & video apps automatically when workers clock in, restore on break and clock-out. Built for factories & industrial teams.',
    images: ['/icon-512.png'],
  },
  ...(googleVerification
    ? {
        verification: {
          google: googleVerification,
        },
      }
    : {}),
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ShiftFocus',
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    shortcut: '/favicon.ico',
    apple: '/icon-192.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#1e88e5',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {gaMeasurementId ? (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}
              strategy="afterInteractive"
            />
            <Script id="ga4-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date()); gtag('config', '${gaMeasurementId}');`}
            </Script>
          </>
        ) : null}
        {children}
      </body>
    </html>
  );
}
