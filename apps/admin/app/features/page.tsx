import type { Metadata } from 'next';
import Link from 'next/link';
import { DEFAULT_KEYWORDS, SITE_NAME, SITE_URL } from '../seo';

export const metadata: Metadata = {
  title: 'How ShiftFocus Works — Features, Privacy & Industrial Shift FAQ',
  description:
    'Learn how ShiftFocus links biometric and HR attendance punches to Android Enterprise focus policies for factories, warehouses, and manufacturing teams—with zero personal tracking.',
  keywords: [
    ...DEFAULT_KEYWORDS,
    'how to reduce phone distraction in factory',
    'manufacturing shift phone policy',
    'warehouse worker focus app',
    'Android Enterprise focus policy',
  ],
  alternates: {
    canonical: '/features',
  },
  openGraph: {
    title: 'How ShiftFocus Works — Industrial Shift Focus & Privacy FAQ',
    description:
      'Attendance-linked focus controls for factories and warehouses: automatic clock-in enforcement, break-time restore, and 1-tap emergency override.',
    url: `${SITE_URL}/features`,
    siteName: SITE_NAME,
    type: 'article',
  },
};

const faqs = [
  {
    q: 'How does ShiftFocus know when a worker is on shift?',
    a: 'ShiftFocus connects to your existing biometric gate terminal or HR attendance system via lightweight connector webhooks (clock_in, break_start, break_end, clock_out). Focus policies apply only during verified active shift windows.',
  },
  {
    q: 'Which apps stay available during an active shift?',
    a: 'Essential communication and safety apps—including Phone calls, SMS Messages, and WhatsApp—remain always accessible. Only configured distracting social or short-video apps (such as Instagram, YouTube, or Facebook) are paused during active shift hours.',
  },
  {
    q: 'What happens if a worker has a family or medical emergency?',
    a: 'Workers can tap the 1-tap Emergency Override button inside the ShiftFocus Employee Mobile App (/worker) at any time to immediately restore full app access without waiting for administrator approval.',
  },
  {
    q: 'Does ShiftFocus read messages, call logs, or track GPS location?',
    a: 'No. ShiftFocus enforces strict privacy guardrails: it never reads personal messages, call history, photos, or GPS location. It only manages app visibility during verified shift hours.',
  },
  {
    q: 'What if a worker forgets to clock out at the end of a shift?',
    a: 'ShiftFocus includes a bounded fail-safe shift duration (12 hours maximum by default) so normal app access is automatically restored even if a clock-out punch is missed.',
  },
];

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: {
      '@type': 'Answer',
      text: item.a,
    },
  })),
};

export default function FeaturesPage() {
  return (
    <main style={{ maxWidth: 960, margin: '36px auto', padding: '0 20px 64px' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 32 }}>
        <Link href="/" className="brand-cluster" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="brand-mark">SF</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>ShiftFocus</div>
            <div className="brand-subtitle">Attendance-Linked Workplace Focus</div>
          </div>
        </Link>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/" className="btn btn-sm" style={{ textDecoration: 'none' }}>
            Open Admin Console
          </Link>
          <Link href="/worker" className="btn btn-sm btn-primary" style={{ textDecoration: 'none' }}>
            📱 Employee Mobile App
          </Link>
        </div>
      </header>

      <section style={{ marginBottom: 36 }}>
        <h1 style={{ fontSize: 32, lineHeight: 1.2, margin: '0 0 12px', fontWeight: 750, letterSpacing: '-0.02em' }}>
          Reduce Shift Distractions Without 24/7 Phone Lockdown
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 16, lineHeight: 1.65, margin: 0 }}>
          Built for manufacturing plants, warehouses, and industrial shop floors, ShiftFocus links your attendance
          punches directly to Android Enterprise focus policies—keeping workers focused on safety and quality during
          active shifts while respecting personal time.
        </p>
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 16,
          marginBottom: 40,
        }}
      >
        <article className="panel panel-pad">
          <h2 style={{ fontSize: 16, margin: '0 0 8px', fontWeight: 650 }}>1. Clock-In Focus Enforcement</h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13.5, lineHeight: 1.6 }}>
            When an employee punches in at the gate, ShiftFocus receives the <code>clock_in</code> event and pauses
            configured social and short-video apps within seconds.
          </p>
        </article>
        <article className="panel panel-pad">
          <h2 style={{ fontSize: 16, margin: '0 0 8px', fontWeight: 650 }}>2. Break &amp; Clock-Out Restore</h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13.5, lineHeight: 1.6 }}>
            Verified <code>break_start</code> and <code>clock_out</code> punches automatically lift restrictions, plus a
            12-hour fail-safe guarantees phones are never stuck in focus mode.
          </p>
        </article>
        <article className="panel panel-pad">
          <h2 style={{ fontSize: 16, margin: '0 0 8px', fontWeight: 650 }}>3. Instant Emergency Override</h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13.5, lineHeight: 1.6 }}>
            Phone, SMS, and WhatsApp stay open 100% of the time, and any worker can trigger a 1-tap Emergency Override
            from the mobile app without waiting for HR.
          </p>
        </article>
      </section>

      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 22, margin: '0 0 16px', fontWeight: 700 }}>Frequently Asked Questions</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {faqs.map((item) => (
            <article key={item.q} className="panel panel-pad">
              <h3 style={{ fontSize: 15, margin: '0 0 6px', fontWeight: 650 }}>{item.q}</h3>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13.5, lineHeight: 1.6 }}>{item.a}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel panel-pad" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, margin: '0 0 4px', fontWeight: 700 }}>Try the Live Interactive Pilot</h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13.5 }}>
            Test gate clock-in punches, policy updates, and the installable worker mobile app in under 60 seconds.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            Launch Pilot Console →
          </Link>
          <Link href="/worker" className="btn" style={{ textDecoration: 'none' }}>
            Open Worker App
          </Link>
        </div>
      </section>
    </main>
  );
}
