export const metadata = {
  title: 'Dock Privacy Policy',
  description: 'Privacy policy for the Dock browser extension and supporting services.',
}

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '48px 24px 72px', fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', lineHeight: 1.6, color: '#172033' }}>
      <h1 style={{ fontSize: 40, marginBottom: 8 }}>Dock Privacy Policy</h1>
      <p style={{ color: '#5a6475', marginTop: 0 }}>Last updated: September 4, 2026</p>

      <p>
        This policy describes how Dock, including the Dock browser extension and its supporting web services,
        handles information when you use the product. Dock is designed to let people intentionally save browser
        tabs and related context, return to those saved items in Safe Harbor, and receive managed workspace content
        when their organization uses Dock.
      </p>

      <h2>Information Dock handles</h2>
      <p>Depending on the features you use, Dock may handle:</p>
      <ul>
        <li>Account information, such as the email address associated with sign-in.</li>
        <li>Organization or district association needed to deliver a managed Dock and enforce access or licensing.</li>
        <li>Information you intentionally save, including page titles, page URLs, optional notes or reasons, favicon URLs, and save timestamps.</li>
        <li>Screenshots or screenshot availability status when a save or Dock'em All action requests a visual preview and Chrome permits capture.</li>
        <li>Extension version, last-seen, and related operational information needed for compatibility, diagnostics, licensing, and managed-workspace delivery.</li>
        <li>Content you intentionally place into a Dock share when you choose to create a share link.</li>
      </ul>

      <h2>How Dock uses this information</h2>
      <p>Dock uses this information only to provide and operate its user-facing purpose, including to:</p>
      <ul>
        <li>save and render your Safe Harbor memories;</li>
        <li>sync supported personal-memory data for a signed-in account;</li>
        <li>deliver and refresh organization-managed workspace content;</li>
        <li>create a Dock share when you explicitly request one;</li>
        <li>enforce account, seat, version, and license rules; and</li>
        <li>diagnose, secure, maintain, and improve the reliability of those features.</li>
      </ul>
      <p>
        Dock does not collect browsing activity for advertising. Access to current or open tab information is used
        for Dock's tab-saving features, including user-invoked Dock 1 Tab and Dock'em All actions. Screenshot capture
        is used to create previews for pages a user is saving when Chrome allows capture.
      </p>

      <h2>Screenshots</h2>
      <p>
        When screenshot upload succeeds, Dock's durable personal-memory model stores the screenshot as a file and
        references it by URL rather than keeping a full screenshot data URL in the database. Small local preview data
        may be kept on the device to render Safe Harbor efficiently. Some protected or restricted pages cannot be
        captured; Dock may show a placeholder or unavailable state in those cases.
      </p>

      <h2>Service providers and sharing</h2>
      <p>
        Dock uses service providers to operate the product. These include Google for supported sign-in flows,
        Supabase for authentication, database, and file-storage services, and Vercel for hosting Dock's supporting web
        application and APIs. Information is transmitted to these providers only as needed to provide Dock's features
        and operations. Authorized Dock owner or organization administrators may also have access to limited account,
        organization, licensing, installation, or diagnostic information needed to operate an organization deployment.
      </p>
      <p>
        If you intentionally create a Dock share, the content included in that share is made available through the
        resulting share link. You should only share content you intend recipients of that link to access.
      </p>

      <h2>No sale of user data or personalized advertising</h2>
      <p>
        Dock does not sell user data and does not use or transfer user data for personalized, retargeted, or
        interest-based advertising.
      </p>

      <h2>Chrome Web Store Limited Use</h2>
      <p>
        Dock's use of information received from Google APIs adheres to the Chrome Web Store User Data Policy,
        including the Limited Use requirements. Dock limits use of user data to providing or improving Dock's
        disclosed single purpose and related user-facing features. Dock does not sell user data or use it for
        personalized advertising, and it only transfers user data when necessary to provide Dock's features,
        comply with applicable law, protect against fraud or abuse, or as otherwise permitted by the policy.
        Humans are not permitted to read personal or sensitive user data except where specifically allowed by the
        policy, such as with the user's explicit consent for support, for security purposes, to comply with law,
        or for properly aggregated and anonymized internal operations.
      </p>

      <h2>Permissions</h2>
      <p>
        Dock requests browser permissions needed for its existing features. These include storage for local Dock
        state; tabs and active-tab access for user-directed tab saving and capture; alarms for managed-workspace
        refresh; identity access for sign-in and account association; and host access needed to save and create
        previews for arbitrary web pages that the user chooses to Dock. Dock also uses expanded local storage because
        screenshot-rich Safe Harbor data can exceed Chrome's default local storage quota.
      </p>

      <h2>Your controls</h2>
      <p>Depending on the feature and account state, users can:</p>
      <ul>
        <li>choose what pages to save;</li>
        <li>delete personal memories;</li>
        <li>sign out of Dock;</li>
        <li>choose whether to create a share link; and</li>
        <li>request account-data assistance, deletion, or export through the developer support contact provided with Dock's product listing.</li>
      </ul>

      <h2>Security</h2>
      <p>
        Dock uses HTTPS for network communications with its supporting services and limits use of collected data to
        the product functions and operational purposes described above. Authentication credentials and service secrets
        are not intended to be exposed in public product data.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        If Dock's data practices materially change, this policy will be updated and any additional disclosure or
        consent required by the applicable browser-store rules will be provided before the changed practice is used.
      </p>
    </main>
  )
}
