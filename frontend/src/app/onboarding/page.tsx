'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { setAccessToken } from '@/lib/token-utils';
import Image from 'next/image'
import { RESCUE_TO_INBOX_ENABLED } from '@/lib/feature-flags'

// Define TypeScript interfaces
interface Chip {
  value: string;
  label: string;
  description?: string;
  dynamic?: boolean;
  exampleDomains?: string[]; // Add example domains for suggestion chips
}

interface Question {
  id: string;
  title: string;
  subtitle: string;
  chips: Chip[];
  placeholder: string;
  customField?: string;
  isMultiSelect?: boolean;
  isMultiInput?: boolean;
  skipAutoNext?: boolean;
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:53001';

// Updated questions with expanded use cases
const questions: Question[] = [
  {
    id: 'user_role',
    title: 'Onboarding: What describes you best?',
    subtitle: 'Helps me speak your language and understand what matters.',
    chips: [
      { value: 'founder_ceo', label: 'Founder / CEO / Director' },
      { value: 'sales', label: 'Sales & Business Dev' },
      { value: 'marketing', label: 'Marketing / Growth' },
      { value: 'engineering', label: 'Engineering / Product' },
      { value: 'investor', label: 'Investor / VC' },
      { value: 'real_estate', label: 'Real Estate' },
      { value: 'freelancer', label: 'Freelancer / Consultant' },
      { value: 'healthcare_legal', label: 'Healthcare / Legal / Finance' },
    ],
    placeholder: 'Type your title...',
    customField: 'user_role_custom',
  },
  {
    id: 'priority_emails',
    title: "Onboarding: What emails can't you miss?",
    subtitle: "I'll rescue these from spam and flag them immediately.",
    chips: [
      { value: 'new_business', label: 'New Business Inquiries' },
      { value: 'client_comm', label: 'Client & Partner Messages' },
      { value: 'investor_updates', label: 'Investor & Board Updates' },
      { value: 'job_offers', label: 'Job Offers' },
      { value: 'legal_contracts', label: 'Legal Notices & Contracts' },
      { value: 'financial_bills', label: 'Bills, Invoices & Payments' },
      { value: 'travel_bookings', label: 'Travel Bookings' },
      { value: 'medical_updates', label: 'Medical & Health' },
      { value: 'family_friends', label: 'Family & Friends' },
    ],
    placeholder: 'e.g., "school notifications", "HOA emails"...',
    customField: 'priority_emails_custom',
    isMultiSelect: true,
  },
  {
    id: 'target_audience',
    title: 'Onboarding: Who sends you the most important emails?',
    subtitle: 'Helps me recognize legitimate senders instantly.',
    chips: [
      { value: 'b2b_enterprise', label: 'Corporates & Enterprises' },
      { value: 'small_business', label: 'Small Businesses & Startups' },
      { value: 'consumers', label: 'Individual People' },
      { value: 'government', label: 'Government & Institutions' },
    ],
    placeholder: 'Describe them...',
    customField: 'target_audience_custom',
  },
  {
    id: 'priority_senders',
    title: 'Onboarding: Which senders are always important?',
    subtitle: "I'll never let emails from these domains land in spam.",
    chips: [
      { value: 'my_domain', label: 'My Company Domain', dynamic: true },
      {
        value: 'key_clients',
        label: 'Key Client Domains',
        exampleDomains: ['client1.com', 'partner.io', 'customer.net']
      },
      {
        value: 'financial_services',
        label: 'Banks & Payment Services',
        exampleDomains: ['stripe.com', 'paypal.com', 'chase.com', 'wise.com']
      },
      {
        value: 'government_official',
        label: 'Government & Official',
        exampleDomains: ['irs.gov', 'usps.com', 'ssa.gov', 'hmrc.gov.uk']
      },
      {
        value: 'travel_companies',
        label: 'Travel & Accommodation',
        exampleDomains: ['airbnb.com', 'booking.com', 'expedia.com', 'united.com']
      },
    ],
    placeholder: 'example.com, client.io, bank.com...',
    customField: 'priority_senders_custom',
    isMultiInput: true,
    skipAutoNext: true,
  },
  {
    id: 'deal_breakers',
    title: 'Onboarding: What emails are noise?',
    subtitle: "I'll filter these aggressively so they never distract you.",
    chips: [
      { value: 'cold_sales', label: 'Cold Sales Pitches' },
      { value: 'newsletters', label: 'Marketing Newsletters' },
      { value: 'promotions', label: 'Promotional Deals' },
      { value: 'recruiters', label: 'Recruiter Outreach' },
      { value: 'webinars', label: 'Webinar & Event Invites' },
      { value: 'social_digests', label: 'Social Media Digests' },
      { value: 'surveys', label: 'Survey & Feedback Requests' },
      { value: 'pr_press', label: 'PR & Press Releases' },
    ],
    placeholder: 'e.g., "charity solicitations", "alumni emails"...',
    customField: 'deal_breakers_custom',
    isMultiSelect: true,
  },
  {
    id: 'spam_handling',
    title: 'Onboarding: When I rescue emails from spam:',
    subtitle: 'Choose how rescued emails should be handled.',
    chips: [
      { value: 'review_first', label: 'Show me first, I\'ll approve', description: 'Safest — you review rescued emails before they hit your inbox' },
      { value: 'manual', label: 'Let me decide case-by-case', description: 'You get a list of rescued emails to action on your own schedule' },
      ...(RESCUE_TO_INBOX_ENABLED ? [{ value: 'auto_move', label: 'Move to inbox automatically', description: 'Trust the AI — rescued emails go straight to your inbox' }] : []),
    ],
    placeholder: '',
    skipAutoNext: true, // User must click "Finish Setup" explicitly
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { openLoginModal } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({
    user_role: '',
    user_role_custom: '',
    priority_emails: [],
    priority_emails_custom: '',
    target_audience: '',
    target_audience_custom: '',
    priority_senders: [],
    priority_senders_custom: '',
    deal_breakers: [],
    deal_breakers_custom: '',
    spam_handling: 'review_first',
  });
  const [customInput, setCustomInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPreOnboardingModal, setShowPreOnboardingModal] = useState(true);
  const [userDomain, setUserDomain] = useState('');
  const [isAnimating, setIsAnimating] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const initialize = async () => {
    // Exchange one-time auth code for access token (CASA compliant).
    // Must complete BEFORE we check localStorage for the token, otherwise
    // the login modal briefly flashes for users arriving via OAuth redirect.
    const urlCode = searchParams?.get('code');
    if (urlCode) {
      window.history.replaceState({}, '', window.location.pathname);
      try {
        const res = await fetch(`${apiUrl}/api/auth/exchange-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: urlCode }),
        });
        const data = await res.json();
        if (data.data?.accessToken) {
          setAccessToken(data.data.accessToken);
        }
      } catch (e) {
        console.error('Failed to exchange auth code:', e);
      }
    }

    const rawRedirect = sessionStorage.getItem('redirectAfterLogin') || '';
    sessionStorage.removeItem('redirectAfterLogin');
    // Validate: only allow same-origin relative paths (OWASP A01 — open redirect guard)
    const safeRedirect = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '';
    // Also ignore /select-plan — new OAuth users land there, pick a plan, then arrive here
    const ONBOARDING_FLOW_PATHS = ['/onboarding', '/select-plan'];
    if (safeRedirect && !ONBOARDING_FLOW_PATHS.includes(safeRedirect)) {
      router.push(safeRedirect);
      return;
    }

    const fetchUserDomain = async () => {
      try {
        const token = localStorage.getItem('accessToken');
        if (!token) {
          setIsChecking(false);
          openLoginModal();
          return;
        }

        // Check if we have a session_id from Stripe checkout - verify it immediately
        // Validate format before sending: Stripe session IDs are cs_[live|test]_[alphanumeric]
        const rawSessionId = searchParams?.get('session_id') || '';
        const sessionId = /^cs_[a-zA-Z0-9_]{10,200}$/.test(rawSessionId) ? rawSessionId : null;
        if (sessionId) {
          try {
            const verifyResponse = await fetch(`${apiUrl}/api/billing/verify-checkout`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ sessionId }),
            });

            if (verifyResponse.ok) {
              // Clean up URL — session_id must not linger in browser history
              window.history.replaceState({}, '', '/onboarding');
            } else {
              console.error('[Onboarding] Failed to verify checkout session');
            }
          } catch (verifyError) {
            console.error('[Onboarding] Error verifying checkout:', verifyError);
          }
        }

        // Check if user has selected a plan (has active subscription/trial)
        let hasValidSubscription = false;
        let attempts = 0;
        const maxAttempts = 5; // Reduced since we verify checkout directly now

        while (attempts < maxAttempts && !hasValidSubscription) {
          try {
            const subResponse = await fetch(`${apiUrl}/api/billing/status`, {
              headers: { Authorization: `Bearer ${token}` },
            });

            if (subResponse.ok) {
              const subData = await subResponse.json();
              const status = subData.data?.status;
              const canUse = subData.data?.canUse;

              // If user has a valid subscription, break the loop
              if (status !== 'no_subscription' && status !== 'trial_expired' && status !== 'expired' && canUse !== false) {
                hasValidSubscription = true;
                break;
              }

              // Wait 1 second before retrying
              await new Promise(resolve => setTimeout(resolve, 1000));
              attempts++;
            } else {
              await new Promise(resolve => setTimeout(resolve, 1000));
              attempts++;
            }
          } catch (subError) {
            console.error('[Onboarding] Error checking subscription:', subError);
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
          }
        }

        // If still no valid subscription after retries, redirect to plan selection
        if (!hasValidSubscription) {
          router.push('/select-plan');
          return;
        }

        const response = await fetch(`${apiUrl}/api/users/context`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (response.ok) {
          const data = await response.json();
          if (data.data?.user_domain) {
            setUserDomain(data.data.user_domain);
          }
          if (data.data?.onboarding_completed) {
            router.push('/dashboard');
            return;
          }
        }
        setIsChecking(false);
      } catch (error) {
        console.error('Error fetching user context:', error);
        setIsChecking(false);
      }
    };

    await fetchUserDomain();
    }; // end initialize

    initialize();
  }, [router, searchParams]);

  const currentQuestion = questions[currentStep];
  const progress = ((currentStep + 1) / questions.length) * 100;

  const handleChipSelect = (value: string, chip?: Chip) => {
    const question = currentQuestion;

    if (question.isMultiSelect) {
      const currentSelections = answers[question.id] || [];
      const newSelections = currentSelections.includes(value)
        ? currentSelections.filter((v: string) => v !== value)
        : [...currentSelections, value];
      setAnswers({ ...answers, [question.id]: newSelections });
    } else if (question.id === 'priority_senders') {
      // Handle priority_senders specially
      if (value === 'my_domain' && userDomain) {
        const currentDomains = answers.priority_senders || [];
        if (!currentDomains.includes(userDomain)) {
          const newDomains = [...currentDomains, userDomain];
          setAnswers({ ...answers, priority_senders: newDomains });
        } else {
          const newDomains = currentDomains.filter((d: string) => d !== userDomain);
          setAnswers({ ...answers, priority_senders: newDomains });
        }
      } else {
        // For other suggestion chips, pre-fill the input with examples
        if (chip?.exampleDomains) {
          setSelectedSuggestion(value);
          // Pre-fill input with examples
          setCustomInput(chip.exampleDomains.join(', '));
        }
      }
    } else {
      setAnswers({ ...answers, [question.id]: value });
      if (!question.skipAutoNext) {
        setTimeout(() => goToNextStep(), 200);
      }
    }
  };

  const handleCustomInput = () => {
    if (!customInput.trim()) return;

    const question = currentQuestion;

    if (question.isMultiInput) {
      const MAX_DOMAIN_LENGTH = 253; // RFC 1035 maximum domain name length
      const MAX_DOMAINS = 50;        // Reasonable upper bound
      const domains = customInput.split(',').map(d =>
        d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
      ).filter(d => d.length > 0 && d.length <= MAX_DOMAIN_LENGTH);

      const currentDomains = answers.priority_senders || [];
      const merged = [...new Set([...currentDomains, ...domains])];
      const newDomains = merged.slice(0, MAX_DOMAINS);
      setAnswers({ ...answers, priority_senders: newDomains });
      setCustomInput('');
      setSelectedSuggestion(null); // Clear suggestion after adding
    } else if (question.customField) {
      setAnswers({ ...answers, [question.customField]: customInput });
      setCustomInput('');
      setTimeout(() => goToNextStep(), 200);
    }
  };

  const goToNextStep = () => {
    // Auto-save any pending typed domains before advancing
    if (customInput.trim() && currentQuestion.isMultiInput) {
      handleCustomInput();
    }
    if (currentStep < questions.length - 1) {
      setIsAnimating(true);
      setTimeout(() => {
        setCurrentStep(currentStep + 1);
        setCustomInput('');
        setSelectedSuggestion(null);
        setIsAnimating(false);
      }, 300);
    } else {
      handleComplete();
    }
  };

  const goToPrevStep = () => {
    // Auto-save any pending typed domains before going back
    if (customInput.trim() && currentQuestion.isMultiInput) {
      handleCustomInput();
    }
    if (currentStep > 0) {
      setIsAnimating(true);
      setTimeout(() => {
        setCurrentStep(currentStep - 1);
        setCustomInput('');
        setSelectedSuggestion(null);
        setIsAnimating(false);
      }, 300);
    }
  };

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      const token = localStorage.getItem('accessToken');
      if (!token) {
        openLoginModal();
        return;
      }

      // Auto-detect user timezone
      const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

      const apiData = {
        ...answers,
        primary_goal: answers.priority_emails?.length > 0 ? answers.priority_emails[0] : '',
        primary_goal_custom: answers.priority_emails_custom,
        whitelist_domains: answers.priority_senders,
        timezone: detectedTimezone,
      };

      const response = await fetch(`${apiUrl}/api/users/context`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(apiData),
      });

      if (response.ok) {
        await fetch(`${apiUrl}/api/users/onboarding/complete`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });

        // Fire-and-forget scan on all connected mailboxes (the Gmail/Outlook mailbox
        // was auto-connected at login time, so it exists by the time we reach here).
        try {
          const mailboxRes = await fetch(`${apiUrl}/api/mailboxes`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (mailboxRes.ok) {
            const mailboxData = await mailboxRes.json();
            const mailboxList: any[] = mailboxData.data?.mailboxes || [];
            mailboxList.forEach((mb: any) => {
              fetch(`${apiUrl}/api/messages/scan/${mb.id}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
              }).catch(() => {});
            });
          }
        } catch {
          // Non-fatal — user can trigger scan manually from dashboard
        }

        // Go to messages page with scanning=true to show the progress modal
        router.push('/messages?scanning=true');
      }
    } catch (error) {
      console.error('Error saving onboarding data:', error);
      setIsSubmitting(false);
    }
  };

  const isStepComplete = () => {
    const question = currentQuestion;
    if (question.isMultiSelect) {
      return (answers[question.id] || []).length > 0 || (question.customField && answers[question.customField]);
    }
    if (question.id === 'priority_senders') {
      return true;
    }
    return answers[question.id] || (question.customField && answers[question.customField]);
  };

  const isDomainChipSelected = (chipValue: string, chip?: Chip) => {
    if (!answers.priority_senders) return false;

    if (chipValue === 'my_domain' && userDomain) {
      return answers.priority_senders.includes(userDomain);
    }

    // For suggestion chips with example domains, check if any are already added
    if (chip?.exampleDomains) {
      return chip.exampleDomains.some((d: string) => answers.priority_senders.includes(d));
    }

    // For pre-fill suggestion chips, check if they're currently selected
    return selectedSuggestion === chipValue;
  };

  const removeDomain = (domain: string) => {
    const newDomains = answers.priority_senders.filter((d: string) => d !== domain);
    setAnswers({ ...answers, priority_senders: newDomains });
  };

  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F9F8F4]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#FF5E1A] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F9F8F4] text-[#1A1A1A] font-sans selection:bg-[#FF5E1A] selection:text-white">
      
      <style jsx global>{`
        .paper-texture {
          background-image: url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.05'/%3E%3C/svg%3E");
        }
        .shadow-solid { box-shadow: 6px 6px 0px 0px rgba(26,26,26,1); }
        .shadow-solid-sm { box-shadow: 3px 3px 0px 0px rgba(26,26,26,1); }
        .shadow-solid-hover { box-shadow: 2px 2px 0px 0px rgba(26,26,26,1); }
      `}</style>
      
      <div className="fixed inset-0 pointer-events-none paper-texture z-0" />

      {/* Pre-Onboarding Modal */}
      {showPreOnboardingModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-[#1A1A1A]/80 backdrop-blur-sm" />

          {/* Modal card */}
          <div className="relative w-full max-w-lg bg-[#F9F8F4] border-2 border-[#1A1A1A] shadow-solid rounded-lg overflow-hidden">

            {/* Orange top bar */}
            <div className="h-2 w-full bg-[#FF5E1A]" />

            <div className="p-8">
              {/* Badge */}
              <div className="inline-block bg-yellow-300 border-2 border-[#1A1A1A] px-3 py-1 rounded-sm shadow-solid-sm rotate-[-1.5deg] mb-6">
                <span className="font-bold uppercase tracking-wider text-xs">2-min setup</span>
              </div>

              {/* Headline */}
              <h2 className="font-display text-3xl font-black text-[#1A1A1A] leading-tight tracking-tight mb-2">
                Your inbox is about to get a lot smarter.
              </h2>
              <p className="text-base text-gray-600 font-medium mb-8">
                Before we start scanning, answer 6 quick questions so the AI knows exactly what matters to you.
              </p>

              {/* 3 value props */}
              <div className="space-y-4 mb-8">
                <div className="flex items-start gap-4 bg-white border-2 border-[#1A1A1A] rounded-lg p-4 shadow-solid-sm">
                  <div className="flex-shrink-0 w-10 h-10 bg-[#FF5E1A] border-2 border-[#1A1A1A] rounded-lg flex items-center justify-center text-white text-lg font-black">
                    1
                  </div>
                  <div>
                    <p className="font-bold text-[#1A1A1A] text-sm leading-snug">Personalized spam detection</p>
                    <p className="text-xs text-gray-500 mt-0.5">The AI learns your role and priorities — not a generic spam filter.</p>
                  </div>
                </div>

                <div className="flex items-start gap-4 bg-white border-2 border-[#1A1A1A] rounded-lg p-4 shadow-solid-sm">
                  <div className="flex-shrink-0 w-10 h-10 bg-[#FF5E1A] border-2 border-[#1A1A1A] rounded-lg flex items-center justify-center text-white text-lg font-black">
                    2
                  </div>
                  <div>
                    <p className="font-bold text-[#1A1A1A] text-sm leading-snug">Zero missed emails</p>
                    <p className="text-xs text-gray-500 mt-0.5">Tell us who and what matters — we'll rescue those from spam automatically.</p>
                  </div>
                </div>

                <div className="flex items-start gap-4 bg-white border-2 border-[#1A1A1A] rounded-lg p-4 shadow-solid-sm">
                  <div className="flex-shrink-0 w-10 h-10 bg-[#FF5E1A] border-2 border-[#1A1A1A] rounded-lg flex items-center justify-center text-white text-lg font-black">
                    3
                  </div>
                  <div>
                    <p className="font-bold text-[#1A1A1A] text-sm leading-snug">Your answers stay private</p>
                    <p className="text-xs text-gray-500 mt-0.5">Context is used only to tune your classifier — never shared or sold.</p>
                  </div>
                </div>
              </div>

              {/* CTA */}
              <button
                onClick={() => setShowPreOnboardingModal(false)}
                className="w-full bg-[#FF5E1A] text-white font-bold text-base border-2 border-[#1A1A1A] rounded-lg py-4 px-6 shadow-solid transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[6px_8px_0px_0px_rgba(26,26,26,1)] active:translate-y-1 active:shadow-solid-hover flex items-center justify-center gap-2"
              >
                <span>Personalize my inbox</span>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="sticky top-0 z-50 bg-white/95 border-b-2 border-[#1A1A1A]">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex justify-between items-center">
            <div className="relative flex items-center justify-center">
              <Image
                src="/logo.svg"
                alt="MyInboxer"
                width={160}
                height={36}
                className="object-contain"
                priority
              />
            </div>

            <div className="flex flex-col items-end gap-1 w-1/3">
              <div className="text-xs font-bold uppercase tracking-widest text-gray-500">
                Setup Progress
              </div>
              <div className="w-full h-3 bg-white border-2 border-[#1A1A1A] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#FF5E1A] transition-all duration-500 ease-out border-r-2 border-[#1A1A1A]"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full px-4 py-6 relative z-10">
        
        <div className={`flex-1 transition-all duration-300 ease-out transform ${isAnimating ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'}`}>
          
          <div className="inline-block bg-yellow-300 border-2 border-[#1A1A1A] px-3 py-1 rounded-sm shadow-solid-sm rotate-[-2deg] mb-6">
            <span className="font-bold uppercase tracking-wider text-xs">Step {currentStep + 1} of {questions.length}</span>
          </div>

          <div className="mb-8">
            <h1 className="font-display text-3xl font-black text-[#1A1A1A] mb-2 leading-tight tracking-tight">
              {currentQuestion.title}
            </h1>
            <p className="text-base font-medium text-gray-600">
              {currentQuestion.subtitle}
            </p>
          </div>

          <div className="mb-6">
            <div className={currentStep === 5 ? "space-y-3" : "grid grid-cols-1 sm:grid-cols-2 gap-3"}>
              {currentQuestion.chips.map((chip) => {
                let isSelected = false;
                
                if (currentQuestion.isMultiSelect) {
                  isSelected = (answers[currentQuestion.id] || []).includes(chip.value);
                } else if (currentQuestion.id === 'priority_senders') {
                  isSelected = isDomainChipSelected(chip.value, chip);
                } else {
                  isSelected = answers[currentQuestion.id] === chip.value;
                }

                return (
                  <button
                    key={chip.value}
                    onClick={() => handleChipSelect(chip.value, chip)}
                    className={`
                      group relative w-full text-left p-4 border-2 border-[#1A1A1A] rounded-lg transition-all duration-150
                      ${isSelected 
                        ? 'bg-[#FF5E1A] text-white shadow-solid-hover translate-x-[4px] translate-y-[4px]' 
                        : 'bg-white text-[#1A1A1A] shadow-solid hover:-translate-y-1 hover:-translate-x-0.5'
                      }
                    `}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex flex-col">
                        <span className={`font-display font-bold text-base leading-tight ${isSelected ? 'text-white' : 'text-[#1A1A1A]'}`}>
                          {chip.dynamic && userDomain ? `@${userDomain}` : chip.label}
                        </span>
                        {chip.description && (
                          <span className={`text-xs mt-1 font-medium ${isSelected ? 'text-white/90' : 'text-gray-500'}`}>
                            {chip.description}
                          </span>
                        )}
                        {currentQuestion.id === 'priority_senders' && chip.exampleDomains && (
                          <div className="mt-1">
                            <span className={`text-xs ${isSelected ? 'text-white/80' : 'text-gray-500'}`}>
                              Examples: {chip.exampleDomains.slice(0, 2).join(', ')}...
                            </span>
                          </div>
                        )}
                      </div>
                      
                      {isSelected && (
                        <div className="bg-white border-2 border-[#1A1A1A] rounded-full w-5 h-5 flex items-center justify-center text-[#1A1A1A] text-xs">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            
            {currentQuestion.id === 'priority_senders' && (
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs text-black-800 font-medium mb-1">
                  💡 How to use these options:
                </p>
                <ul className="text-xs text-black-700 list-disc pl-4 space-y-0.5">
                  <li><strong>My Company Domain:</strong> Automatically adds your company's domain</li>
                  <li><strong>Work Tools:</strong> Toggles common work tool domains</li>
                  <li><strong>Other categories:</strong> Click to pre-fill examples</li>
                </ul>
              </div>
            )}
          </div>

          {currentQuestion.id === 'priority_senders' && (answers.priority_senders || []).length > 0 && (
            <div className="mb-6 p-3 bg-[#E3E8E1] border-2 border-[#1A1A1A] rounded-lg shadow-solid-sm">
              <div className="flex justify-between items-center mb-2">
                <div className="text-xs font-bold uppercase">Selected Domains:</div>
                <button
                  onClick={() => setAnswers({ ...answers, priority_senders: [] })}
                  className="text-xs text-red-600 hover:text-red-800 font-medium"
                >
                  Clear All
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {answers.priority_senders.map((domain: string) => (
                  <div
                    key={domain}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border-2 border-[#1A1A1A] rounded-full text-xs font-bold shadow-sm"
                  >
                    <span>@{domain}</span>
                    <button
                      onClick={() => removeDomain(domain)}
                      className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-red-100 text-red-500 text-xs"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentQuestion.id !== 'spam_handling' && (
            <div className="mb-8">
              <label className="block text-xs font-bold uppercase tracking-wider mb-1 ml-1">
                {currentQuestion.id === 'priority_senders'
                  ? (selectedSuggestion ? `Add your ${currentQuestion.chips.find(c => c.value === selectedSuggestion)?.label.toLowerCase()}` : 'Add specific domains')
                  : 'Or add your own...'}
              </label>
              {currentQuestion.id === 'priority_senders' && (
                <p className="text-xs text-gray-500 mb-2 ml-1">
                  Type one or more domain names separated by commas, then click <strong>Add</strong>
                </p>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCustomInput();
                  }}
                  placeholder={currentQuestion.placeholder}
                  maxLength={currentQuestion.isMultiInput ? 1000 : 500}
                  className="flex-1 px-5 py-3 bg-white border-2 border-[#1A1A1A] rounded-full text-base font-bold placeholder-gray-400 focus:outline-none focus:border-[#FF5E1A] focus:ring-1 focus:ring-[#FF5E1A] shadow-solid-sm transition-all"
                />
                <button
                  onClick={handleCustomInput}
                  disabled={!customInput.trim()}
                  className={`px-5 py-3 border-2 border-[#1A1A1A] rounded-full font-bold uppercase tracking-wide text-sm transition-all whitespace-nowrap
                    ${customInput.trim()
                      ? 'bg-[#FF5E1A] text-white shadow-solid-sm hover:bg-[#e04e0f] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed border-gray-300'}
                  `}
                >
                  Add →
                </button>
              </div>
              {currentQuestion.id === 'priority_senders' && selectedSuggestion && customInput && (
                <p className="mt-1.5 text-xs text-[#FF5E1A] font-semibold ml-1">
                  ↑ Review the examples above, then click "Add →" to save them
                </p>
              )}
            </div>
          )}

          <div className="flex justify-between items-center pt-6 border-t-2 border-gray-200">
            
            <button
              onClick={goToPrevStep}
              disabled={currentStep === 0}
              className={`
                font-bold uppercase tracking-wide underline decoration-2 underline-offset-4 text-sm
                ${currentStep === 0 ? 'text-gray-300 cursor-not-allowed no-underline' : 'text-[#1A1A1A] hover:text-[#FF5E1A]'}
              `}
            >
              Back
            </button>

            <button
              onClick={currentStep === questions.length - 1 ? handleComplete : goToNextStep}
              disabled={isSubmitting}
              className={`
                relative px-6 py-3 bg-[#1A1A1A] text-white border-2 border-[#1A1A1A] rounded-full font-bold uppercase tracking-widest text-xs shadow-solid hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-solid-hover transition-all
                ${isSubmitting ? 'opacity-80 cursor-wait' : 'hover:bg-[#FF5E1A] hover:border-[#FF5E1A]'}
              `}
            >
              {isSubmitting ? (
                <span>Setup in progress...</span>
              ) : (
                <span className="flex items-center gap-1.5">
                  {currentStep === questions.length - 1 ? 'Finish Setup' : isStepComplete() ? 'Next Step' : 'Skip Step'}
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}