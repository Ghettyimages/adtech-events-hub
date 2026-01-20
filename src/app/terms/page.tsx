import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service | The Media Calendar',
  description: 'Terms of Service for The Media Calendar (themediacalnedar.com).',
};

const LAST_UPDATED = 'January 20, 2026';

export default function TermsPage() {
  return (
    <div className="container mx-auto px-4 py-16">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-8 text-gray-900 dark:text-white">
          Terms of Service
        </h1>

        <div className="prose prose-lg dark:prose-invert max-w-none">
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Last updated: {LAST_UPDATED}
          </p>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              1. Acceptance of Terms
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              By accessing or using <strong>The Media Calendar</strong> (the “Service”) at{' '}
              <strong>themediacalnedar.com</strong>, you agree to these Terms of Service (“Terms”).
              If you do not agree, do not use the Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              2. The Service
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              The Service provides an events calendar experience, including the ability to browse
              events, submit events, follow events, and subscribe to calendar feeds. Some features
              may require an account.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              3. Accounts and Security
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              You are responsible for maintaining the confidentiality of your account credentials
              and for all activity under your account. If you believe your account has been
              compromised, contact us promptly.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              4. Acceptable Use
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              You agree not to misuse the Service. For example, you will not:
            </p>
            <ul className="list-disc pl-6 mb-4 text-gray-700 dark:text-gray-300">
              <li>Violate any law or infringe others’ rights</li>
              <li>Attempt to gain unauthorized access to accounts, systems, or data</li>
              <li>Interfere with or disrupt the Service (including excessive automated requests)</li>
              <li>Upload malware or use the Service to distribute harmful code</li>
              <li>Scrape the Service in a way that harms performance or violates these Terms</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              5. Calendar Feeds, Tokens, and Integrations
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              If you subscribe to a calendar feed, you may receive a unique feed URL/token that
              provides access to your subscription feed. Treat this URL as confidential. If you
              believe it has been shared, you should rotate/recreate it by contacting us or by
              changing your account settings where available.
            </p>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              If you choose to connect Google, the Service may access Google Calendar to perform
              sync actions you request (such as creating or updating events). Your use of Google
              integrations is also subject to Google’s terms and policies.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              6. User Content and Event Submissions
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              You may submit event information (“User Content”). You represent that you have the
              rights necessary to submit it and that it is accurate to the best of your knowledge.
              You grant us a non-exclusive, worldwide, royalty-free license to host, reproduce,
              modify, publish, and display User Content for operating and promoting the Service.
            </p>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              We may review, edit, reject, or remove User Content at any time, but we are not
              obligated to do so.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              7. Third-Party Links and Services
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              The Service may link to third-party websites (e.g., event registration pages) or
              integrate with third-party services (e.g., Google). We are not responsible for
              third-party content, policies, or practices.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              8. Disclaimer of Warranties
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              The Service is provided “as is” and “as available”. To the fullest extent permitted by
              law, we disclaim all warranties, express or implied, including warranties of
              merchantability, fitness for a particular purpose, and non-infringement. We do not
              guarantee the accuracy, completeness, or timeliness of event information.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              9. Limitation of Liability
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              To the fullest extent permitted by law, The Media Calendar will not be liable for any
              indirect, incidental, special, consequential, or punitive damages, or any loss of
              profits or revenues, whether incurred directly or indirectly, or any loss of data,
              use, goodwill, or other intangible losses, resulting from your use of (or inability to
              use) the Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              10. Termination
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              We may suspend or terminate your access to the Service at any time if we believe you
              have violated these Terms, if required by law, or to protect the Service and users.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              11. Changes to These Terms
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              We may update these Terms from time to time. The updated Terms will be posted on this
              page with an updated “Last updated” date. Your continued use of the Service after the
              changes become effective constitutes acceptance of the updated Terms.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">
              12. Contact Information
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              If you have questions about these Terms, contact:
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

