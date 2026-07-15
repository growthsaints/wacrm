import Link from "next/link";

export const metadata = {
  title: "Terms of Service",
};

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-background px-4 py-12 text-foreground">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center gap-3">
          <img
            src="/logo-mark.png"
            alt="Growth Saints"
            className="h-10 w-10 rounded-lg object-cover"
          />
          <span className="text-lg font-semibold">Growth Saints CRM</span>
        </div>

        <h1 className="mb-2 text-3xl font-bold">Terms of Service</h1>
        <p className="mb-10 text-sm text-muted-foreground">
          Last updated: July 15, 2026
        </p>

        <div className="flex flex-col gap-8 text-sm leading-relaxed text-foreground/90">
          <section>
            <p>
              These Terms of Service (&quot;Terms&quot;) govern your access
              to and use of Growth Saints CRM (the &quot;Service&quot;),
              provided by Growth Saints (&quot;we&quot;, &quot;us&quot;, or
              &quot;our&quot;). By creating an account or using the Service,
              you agree to these Terms.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              1. Description of Service
            </h2>
            <p>
              Growth Saints CRM is a customer engagement platform that lets
              businesses connect a WhatsApp Business Account (via Meta&apos;s
              WhatsApp Business Platform) and manage conversations, contacts,
              sales pipelines, campaigns, and automations from a single
              dashboard.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              2. Your Account
            </h2>
            <p>
              You must provide accurate information when creating an
              account and are responsible for keeping your login credentials
              secure. You are responsible for all activity that happens
              under your account, including actions taken by team members
              you invite.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              3. Use of the WhatsApp Business Platform
            </h2>
            <p>
              When you connect a WhatsApp Business Account, you must comply
              with Meta&apos;s{" "}
              <span className="italic">WhatsApp Business Messaging Policy</span>{" "}
              and{" "}
              <span className="italic">Meta Platform Terms</span>, including
              obtaining proper opt-in consent before messaging any Contact,
              honoring opt-out/stop requests, and not sending spam,
              unsolicited, or prohibited content (including messages related
              to illegal goods or services, hate speech, or fraud). We may
              suspend or terminate access to the Service if your use of the
              WhatsApp Business Platform violates Meta&apos;s policies or
              puts our Tech Provider status at risk.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">4. Fees and Payment</h2>
            <p>
              Access to paid plans is billed on the subscription terms shown
              at checkout and processed through Razorpay. Fees are
              non-refundable except where required by law or explicitly
              stated otherwise. In addition to subscription fees, Meta may
              charge conversation-based fees directly for WhatsApp messaging,
              which are billed separately per Meta&apos;s pricing.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              5. Your Content and Data
            </h2>
            <p>
              You retain ownership of the contacts, messages, and other
              content you upload or generate using the Service (&quot;Your
              Content&quot;). You grant us a license to host, process, and
              transmit Your Content solely to provide and improve the
              Service. You are responsible for ensuring you have the right
              to upload and message the contacts you add.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              6. Acceptable Use
            </h2>
            <p>You agree not to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Use the Service to send spam, phishing, or unsolicited bulk messages.</li>
              <li>Message contacts who have not consented to be contacted.</li>
              <li>Use the Service for any unlawful purpose or to violate any third party&apos;s rights.</li>
              <li>Attempt to reverse-engineer, disrupt, or gain unauthorized access to the Service.</li>
              <li>Resell or sublicense the Service without our written consent.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              7. Intellectual Property
            </h2>
            <p>
              The Service, including its software, design, and branding, is
              owned by Growth Saints and protected by intellectual property
              laws. These Terms do not grant you any rights to our
              trademarks or branding beyond what is needed to use the
              Service.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">8. Termination</h2>
            <p>
              You may stop using the Service and close your account at any
              time. We may suspend or terminate your access if you breach
              these Terms, misuse the WhatsApp Business Platform, or fail to
              pay applicable fees. On termination, we may delete your data
              after a reasonable retention period, as described in our
              Privacy Policy.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              9. Disclaimers and Limitation of Liability
            </h2>
            <p>
              The Service is provided &quot;as is&quot; without warranties of
              any kind. We are not liable for message delivery failures,
              account restrictions, or other actions taken by Meta on the
              WhatsApp Business Platform that are outside our control. To
              the maximum extent permitted by law, our total liability for
              any claim relating to the Service is limited to the amount you
              paid us in the twelve months preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">10. Indemnification</h2>
            <p>
              You agree to indemnify and hold Growth Saints harmless from
              any claims, damages, or expenses arising from your use of the
              Service, Your Content, or your violation of these Terms or
              applicable law.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">11. Governing Law</h2>
            <p>
              These Terms are governed by the laws of India, without regard
              to conflict-of-law principles.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              12. Changes to These Terms
            </h2>
            <p>
              We may update these Terms from time to time. If we make
              material changes, we will update the &quot;Last updated&quot;
              date above and, where appropriate, notify you directly.
              Continued use of the Service after changes take effect
              constitutes acceptance of the updated Terms.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">13. Contact Us</h2>
            <p>
              Questions about these Terms can be sent to{" "}
              <a
                href="mailto:growthsaints@gmail.com"
                className="text-primary hover:text-primary/80"
              >
                growthsaints@gmail.com
              </a>
              .
            </p>
          </section>
        </div>

        <div className="mt-12 flex gap-4 border-t border-border pt-6 text-sm">
          <Link href="/privacy" className="text-primary hover:text-primary/80">
            Privacy Policy
          </Link>
          <Link href="/login" className="text-primary hover:text-primary/80">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
