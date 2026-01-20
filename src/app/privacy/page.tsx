import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | The Media Calendar',
  description: 'Privacy Policy for The Media Calendar (themediacalnedar.com).',
};

const LAST_UPDATED = 'January 20, 2026';

export default function PrivacyPage() {
  return (
    <div className="container mx-auto px-4 py-16">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-8 text-gray-900 dark:text-white">
          Privacy Policy
        </h1>

        <div className="prose prose-lg dark:prose-invert max-w-none">
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Last updated: {LAST_UPDATED}
          </p>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              1. Who We Are
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              This Privacy Policy describes how <strong>The Media Calendar</strong> (“we”, “us”,
              “our”) collects, uses, and shares information when you use{' '}
              <strong>themediacalnedar.com</strong> (the “Service”).
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              2. Information We Collect
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              We collect the following categories of information:
            </p>
            <ul className="list-disc pl-6 mb-4 text-gray-700 dark:text-gray-300">
              <li>
                <strong>Account information</strong>: email address, name, and authentication data
                (including hashed passwords if you create a password-based account).
              </li>
              <li>
                <strong>Profile information (optional)</strong>: company, title, company email,
                location, and LinkedIn profile URL (if provided).
              </li>
              <li>
                <strong>Subscriptions and preferences</strong>: events you follow, subscription type
                (full/custom), filtering preferences, and consent flags (e.g., email/calendar
                consent and terms acceptance).
              </li>
              <li>
                <strong>Event submissions and content</strong>: information you submit to list an
                event (e.g., title, dates, location, description, links, and source).
              </li>
              <li>
                <strong>Calendar integration data</strong>: if you connect Google, we may process
                Google OAuth tokens and use Google Calendar API access to create/update/delete
                events you choose to sync.
              </li>
              <li>
                <strong>Usage and device data</strong>: basic log data such as IP address, browser
                type, pages viewed, and approximate timestamps (typically collected automatically by
                hosting/infrastructure).
              </li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              3. How We Use Information
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              We use information to:
            </p>
            <ul className="list-disc pl-6 mb-4 text-gray-700 dark:text-gray-300">
              <li>Provide and operate the Service (accounts, subscriptions, and feeds)</li>
              <li>Personalize your experience (e.g., saved/followed events and filters)</li>
              <li>Sync events to your calendar if you enable calendar features</li>
              <li>Moderate and manage submitted events</li>
              <li>Maintain security, prevent abuse, and debug issues</li>
              <li>Communicate with you about the Service (including transactional messages)</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              4. Cookies and Similar Technologies
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              We use cookies and similar technologies to keep you signed in and to operate the
              Service (for example, authentication/session cookies). You can control cookies through
              your browser settings; disabling cookies may impact functionality.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              5. Sharing and Disclosure
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              We do not sell your personal information. We may share information in these situations:
            </p>
            <ul className="list-disc pl-6 mb-4 text-gray-700 dark:text-gray-300">
              <li>
                <strong>Service providers</strong>: vendors who help us run the Service (e.g. hosting,
                database, email delivery). They can access information only to perform services for
                us and must protect it.
              </li>
              <li>
                <strong>Google APIs (if you connect Google)</strong>: to perform calendar sync actions
                you request. We do not use Google user data for advertising and do not sell it.
              </li>
              <li>
                <strong>Legal and safety</strong>: to comply with law, enforce our terms, or protect
                rights, safety, and security.
              </li>
              <li>
                <strong>Business transfers</strong>: in connection with a merger, acquisition, or
                sale of assets (information may be transferred as part of that transaction).
              </li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              6. Google API Services User Data (Limited Use)
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              If you connect Google, our use and transfer of information received from Google APIs
              will adhere to the{' '}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noreferrer"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements. We use Google Calendar access solely to
              provide the calendar sync features you enable.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              7. Data Retention
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              We keep personal information only as long as necessary to operate the Service, comply
              with legal obligations, resolve disputes, and enforce agreements. You can request
              deletion of your account information as described below.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              8. Your Choices and Rights
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              Depending on where you live, you may have rights to access, correct, delete, or obtain
              a copy of your information, or to object/restrict certain processing. You can also:
            </p>
            <ul className="list-disc pl-6 mb-4 text-gray-700 dark:text-gray-300">
              <li>Update profile information in your account</li>
              <li>Unsubscribe from optional communications where offered</li>
              <li>
                Revoke Google Calendar access in your Google Account settings if you previously
                connected Google
              </li>
            </ul>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              To request access, deletion, or export of your data, contact us using the information
              below.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              9. Security
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              We use reasonable technical and organizational measures designed to protect information.
              No method of transmission or storage is 100% secure, so we cannot guarantee absolute
              security.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              10. Children’s Privacy
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              The Service is not directed to children under 13, and we do not knowingly collect
              personal information from children under 13.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              11. Changes to This Policy
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              We may update this Privacy Policy from time to time. If we make material changes, we
              will post the updated policy on this page and update the “Last updated” date.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              12. Contact Us
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              Questions or requests about this Privacy Policy:
            </p>
            <ul className="list-disc pl-6 mb-4 text-gray-700 dark:text-gray-300">
              <li>
                Email: <a href="mailto:support@themediacalnedar.com">support@themediacalnedar.com</a>
              </li>
              <li>Website: themediacalnedar.com</li>
            </ul>
          </section>
        </div>

        <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
          <Link
            href="/"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

