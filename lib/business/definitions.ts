import {
  addDays,
  annualDue,
  emptyTask,
  type BusinessPlan,
  type BusinessProfile,
  type Structure,
  type TaskRecord,
} from "./domain";
// Reviewed against primary sources on this date. Re-check at least every 90 days.
export const RESEARCH_DATE = "2026-09-09";
export type Source = {
  title: string;
  url: string;
  checkedAt: string;
  status: "VERIFIED" | "REVIEW";
  fallback?: string;
};
const source = (title: string, url: string, fallback?: string): Source => ({
  title,
  url,
  checkedAt: RESEARCH_DATE,
  status: fallback ? "REVIEW" : "VERIFIED",
  fallback,
});
export const sources = {
  sba: source(
    "SBA business structures, banking and insurance",
    "https://www.sba.gov/counseling/launch-your-business/",
  ),
  irsLLC: source(
    "IRS single-member LLC guidance",
    "https://www.irs.gov/businesses/small-businesses-self-employed/single-member-limited-liability-companies",
  ),
  fees: source(
    "Illinois LLC forms and fees",
    "https://www.ilsos.gov/publications/business-services/llc.html",
  ),
  llc: source(
    "Illinois LLC services",
    "https://www.ilsos.gov/departments/business-services/limited-liability-companies.html",
  ),
  articles: source(
    "File Articles of Organization Online",
    "https://apps.ilsos.gov/llcarticles/index.do",
  ),
  annual: source(
    "LLC annual report instructions",
    "https://www.ilsos.gov/departments/business-services/annual-reports/llc-instructions.html",
  ),
  annualLaw: source(
    "Illinois LLC organizing guide — annual deadlines",
    "https://www.ilsos.gov/content/dam/publications/pdf_publications/c334.pdf",
  ),
  mchenry: source(
    "McHenry County filing and publication instructions",
    "https://www.mchenrycountyil.gov/departments/county-clerk/public-filings/business-registration/procedure-for-filing",
  ),
  mchenryForm: source(
    "Download McHenry Assumed Name Certificate",
    "https://www.mchenrycountyil.gov/home/showpublisheddocument/122639/639192046234870000",
  ),
  kane: source(
    "Kane County filing and publication instructions",
    "https://clerk.kanecountyil.gov/VitalRecords/Pages/Business-Registration.aspx",
  ),
  kaneForm: source(
    "Download Kane Assumed Name Certificate",
    "https://clerk.kanecountyil.gov/VitalRecords/Documents/assumed.pdf",
  ),
  ein: source(
    "IRS EIN application and instructions",
    "https://www.irs.gov/businesses/small-businesses-self-employed/get-an-employer-identification-number",
  ),
  idor: source(
    "IDOR business registration",
    "https://tax.illinois.gov/businesses/registration.html",
  ),
  mytax: source(
    "Open MyTax Illinois",
    "https://mytax.illinois.gov/",
    "Dynamic portal could not be inspected; use IDOR's official registration page for the current link or paper REG-1.",
  ),
  reg1: source(
    "Download REG-1",
    "https://tax.illinois.gov/content/dam/soi/en/web/tax/forms/reg/documents/reg-1.pdf",
  ),
  idorFee: source(
    "IDOR registration fee FAQ",
    "https://tax.illinois.gov/questionsandanswers/286",
  ),
  resale: source(
    "CRT-61 instructions",
    "https://tax.illinois.gov/forms/sales/crt-61-instructions.html",
  ),
  crt61: source(
    "Download CRT-61",
    "https://tax.illinois.gov/content/dam/soi/en/web/tax/forms/sales/documents/sales/crt-61.pdf",
  ),
  algonquin: source(
    "Algonquin business-services directory",
    "https://www.algonquin.org/category/?fCS=3-0",
    "Contact municipality—online filing availability not verified. Community Development: 847-658-2700. Official search results list online home registration, but the submission page was not accessible for verification.",
  ),
  lith: source(
    "Lake in the Hills business registration",
    "https://www.lith.org/business/doing-business/business-registration",
  ),
  lithPortal: source(
    "Lake in the Hills Public Portal",
    "https://www.lith.org/government/departments/community-services/community-development/online-permits-contractor-licensing-code-enforcement",
  ),
  stripe: source("Open Stripe", "https://dashboard.stripe.com/register"),
  stripeSole: source(
    "Stripe sole-proprietor guidance",
    "https://support.stripe.com/questions/selling-on-stripe-without-a-separate-business-entity",
    "This support page could not be inspected. Confirm current requirements with Stripe support in your account.",
  ),
  income: source(
    "IRS self-employed tax center",
    "https://www.irs.gov/businesses/small-businesses-self-employed/self-employed-individuals-tax-center",
  ),
  stripeTax: source("Stripe Tax workflow", "https://docs.stripe.com/tax/how-tax-works"),
  salesTax: source(
    "Illinois sales and use tax guidance",
    "https://tax.illinois.gov/research/taxinformation/sales/rot.html",
  ),
  ides: source(
    "IDES new employer registration",
    "https://ides.illinois.gov/employer-resources/taxes-reporting/are-you-a-new-employer-register.html",
  ),
  hires: source(
    "IDES new-hire reporting",
    "https://ides.illinois.gov/employer-resources/taxes-reporting/new-hires.html",
  ),
  workers: source(
    "Illinois workers' compensation review",
    "https://idoi.illinois.gov/wc-fraud/workers-compensation-insurance-compliance.html",
  ),
  boi: source("FinCEN BOI applicability", "https://www.fincen.gov/boi"),
};
export const comparison = [
  [
    "Legal structure",
    "The owner and business are legally the same.",
    "A separate legal entity.",
  ],
  [
    "Liability",
    "Owner is personally responsible for business obligations.",
    "Can limit certain liabilities; personal guarantees and the owner's own wrongdoing remain relevant.",
  ],
  [
    "Default federal income tax",
    "Generally Schedule C and self-employment tax.",
    "Generally the same for one individual owner without a corporate tax election.",
  ],
  [
    "Initial registration",
    "County DBA for the trade name, plus publication.",
    "Illinois LLC formation.",
  ],
  [
    "Basic filing cost",
    "McHenry $5 • Kane $10. Publication and other costs are additional.",
    "$150 standard formation. Other costs are additional.",
  ],
  [
    "Ongoing entity filing",
    "No Illinois LLC annual report.",
    "$75 Illinois LLC annual report.",
  ],
  [
    "Stripe and resale purchases",
    "Available with proper registration.",
    "Available with proper registration.",
  ],
];
export type StepDefinition = {
  key: string;
  title: string;
  why: string;
  instructions: string[];
  method:
    | "Online"
    | "Download and Mail/In Person"
    | "Supplier"
    | "Internal Document"
    | "Provider"
    | "Needs Verification";
  links: Source[];
  notice?: string;
  feeCents: number | null;
  variableCost?: string;
  evidence: string;
  approval?: boolean;
  filing?: boolean;
  unknown?: boolean;
  recurring?: boolean;
  allowNA?: boolean;
  dependencies?: string[];
};
const step = (
  key: string,
  title: string,
  why: string,
  instructions: string[],
  method: StepDefinition["method"],
  links: Source[],
  options: Partial<StepDefinition> = {},
): StepDefinition => ({
  key,
  title,
  why,
  instructions,
  method,
  links,
  feeCents: null,
  evidence:
    "Save supporting evidence or an explicit completion attestation describing what you checked, with the date and authority/provider.",
  ...options,
});
export function definitions(p: BusinessProfile, structure: Structure): StepDefinition[] {
  const county = p.county
    .toLowerCase()
    .replace(/ county$/, "")
    .trim();
  const knownCounty = ["mchenry", "kane"].includes(county);
  const list: StepDefinition[] = [];
  if (structure === "SOLE")
    list.push(
      step(
        "dba",
        knownCounty
          ? `${county === "kane" ? "Kane" : "McHenry"} County assumed business name`
          : "County assumed-name review",
        "DetergentsDelivered is a trade name; confirm the filing required for its actual owner and location.",
        knownCounty
          ? [
              "Complete the county form with the business and owner's physical addresses; sign before a notary.",
              `Submit the original with the ${county === "kane" ? "$10 application fee. Optional county notary service and application copy are $1 each" : "$5 filing fee"}. Keep the filed application and publication notice.`,
              "Arrange one newspaper notice each week for three consecutive weeks in an eligible county newspaper. Obtain an actual publication quote.",
              "First publication must occur within 15 days of filing. Ensure the original publisher's certificate reaches the clerk within 50 days.",
              "Confirm clerk receipt and the final Certificate of Ownership before recording completion.",
            ]
          : [
              "Contact your county clerk through the official county government directory.",
              "Record confirmed fees, submission route, publication deadlines and approval requirements before filing.",
            ],
        knownCounty ? "Download and Mail/In Person" : "Needs Verification",
        knownCounty
          ? county === "kane"
            ? [sources.kane, sources.kaneForm]
            : [sources.mchenry, sources.mchenryForm]
          : [sources.sba],
        {
          feeCents: knownCounty ? (county === "kane" ? 1000 : 500) : null,
          variableCost:
            "Newspaper publication: Quote required. Optional notary/copy costs are separate.",
          filing: true,
          approval: true,
          unknown: !knownCounty,
          allowNA: true,
          notice: knownCounty
            ? "Paper filing: notarization and original submission required; online submission is not listed in the county’s instructions."
            : "Local requirements need verification. Ask the actual county clerk; ZIP alone does not establish jurisdiction.",
          evidence:
            "Filed application, publication proof and final certificate, or an explicit owner attestation covering all three and clerk receipt.",
        },
      ),
    );
  if (structure === "LLC") {
    list.push(
      step(
        "formation",
        "Form the Illinois LLC",
        "An approved filing establishes the legal entity.",
        [
          "Search the state database and choose a compliant, distinguishable LLC legal name.",
          "Identify the registered agent and Illinois registered office, management and organizer information.",
          "File standard Articles of Organization; basic fee $150. Name reservation, expedited service and a paid agent are optional.",
          "Keep the submission receipt. Wait for approval, then record the state file number and actual formation/approval date.",
        ],
        "Online",
        [sources.articles, sources.llc, sources.fees],
        {
          feeCents: 15000,
          variableCost: "Optional services and processing costs vary.",
          approval: true,
          filing: true,
          evidence:
            "Approved Articles of Organization or explicit approval attestation, actual formation date and state file number.",
        },
      ),
    );
    list.push(
      step(
        "agreement",
        "Prepare an operating agreement",
        "Document how your single-member LLC is managed.",
        [
          "Prepare an agreement matching the approved legal entity and ownership.",
          "Sign and retain it with your company records.",
        ],
        "Internal Document",
        [sources.sba, sources.irsLLC],
        {
          feeCents: 0,
          notice: "Internal document—not submitted with this checklist.",
          dependencies: ["formation"],
        },
      ),
    );
    if (p.assumedName !== "NO")
      list.push(
        step(
          "llc-name",
          "Review the LLC operating name",
          "An LLC using another name follows the Secretary of State process.",
          [
            "Compare the operating name with the approved LLC legal name.",
            "Use the LLC assumed-name adoption service; do not use the sole-proprietor county process.",
            "Confirm current fee and retain state approval, or document why no separate name filing is needed.",
          ],
          "Online",
          [sources.llc, sources.fees],
          {
            filing: true,
            approval: true,
            allowNA: true,
            unknown: p.assumedName === "",
            dependencies: ["formation"],
          },
        ),
      );
  }
  list.push(
    step(
      "ein",
      "Federal tax ID (EIN)",
      "An EIN is required in certain situations, including employees, and may be useful for banking or privacy.",
      [
        "Check IRS requirements and whether a valid EIN already exists for this same legal owner.",
        "For a new LLC, wait for state formation approval before applying.",
        "Apply directly with the IRS if needed; enter SSN and identity information only on the IRS site.",
        "Retain the EIN confirmation privately. Do not enter an SSN or IRS password here.",
      ],
      "Online",
      [sources.ein, sources.irsLLC],
      {
        feeCents: 0,
        notice: "Free when obtained directly from the IRS.",
        filing: true,
        approval: true,
        allowNA: p.employees === "NO",
        dependencies: structure === "LLC" ? ["formation"] : [],
      },
    ),
  );
  list.push(
    step(
      "illinois",
      "Illinois sales-tax registration",
      "Consumer product sales are retail activity and must use the actual legal owner.",
      [
        "Review existing registrations before applying again. Confirm the legal owner and every applicable business location.",
        "In MyTax Illinois choose Register a New Business—Form REG-1, or use the paper form.",
        "Select the applicable retail activity. Buying inventory for resale does not make this a reseller-only business.",
        "Track submission separately from approval. Record the Illinois account ID and retain the Certificate of Registration.",
      ],
      "Online",
      [sources.idor, sources.mytax, sources.reg1, sources.idorFee],
      {
        feeCents: 0,
        filing: true,
        approval: true,
        dependencies: structure === "LLC" ? ["formation"] : [],
        notice:
          "MyTax is linked by IDOR; its dynamic portal could not be independently inspected. Paper REG-1 is available.",
      },
    ),
  );
  list.push(
    step(
      "suppliers",
      "Supplier resale certificates",
      "Qualifying inventory for resale may be purchased exempt; supplies and personal purchases do not qualify.",
      [
        "Confirm the state registration and complete CRT-61 for qualifying resale purchases.",
        "Add each supplier below; keep a separate certificate and delivery/acceptance record.",
        "Retail customer sales still require applicable sales tax. Keep supplier records current.",
      ],
      "Supplier",
      [sources.crt61, sources.resale],
      {
        feeCents: 0,
        notice:
          "Give this certificate to your supplier; generally do not submit it to IDOR.",
        dependencies: ["illinois"],
      },
    ),
  );
  const municipality = p.municipality.toLowerCase().trim();
  const lith = municipality === "lake in the hills";
  const algonquin = municipality === "algonquin";
  list.push(
    step(
      "local",
      "Local registration and premises",
      `Confirm ${p.premises === "HOME" ? "home-occupation, storage and zoning" : "commercial occupancy, zoning and storage"} requirements with ${p.municipality || "your municipality"}.`,
      [
        "Confirm municipal jurisdiction using the operating address, not ZIP alone.",
        lith
          ? "Review home-occupation rules or commercial occupancy/building requirements; use the village Public Portal for registration."
          : "Contact municipal Community Development to confirm the filing route, storage limits and required permissions.",
        "Record the municipal response, permits, fees and approval. Resolve any storage, zoning or occupancy conditions before completion.",
      ],
      lith ? "Online" : "Needs Verification",
      lith
        ? [sources.lith, sources.lithPortal]
        : algonquin
          ? [sources.algonquin]
          : [sources.sba],
      {
        unknown: !lith,
        approval: true,
        allowNA: true,
        filing: true,
        notice: lith
          ? "The village lists online business registration; approval is still required."
          : "Contact municipality—online filing availability not verified. Local requirements need verification.",
      },
    ),
  );
  for (const kind of ["bank", "insurance"] as const)
    list.push(
      step(
        kind,
        kind === "bank"
          ? "Dedicated business banking"
          : "Delivery and business insurance",
        kind === "bank"
          ? "Keep business money and legal ownership clear."
          : "Review delivery-vehicle, general liability and product liability coverage.",
        kind === "bank"
          ? [
              "Open or confirm a dedicated account matching the actual legal owner.",
              "Record the bank's website and confirmation. Full statements and unmasked account numbers are not required.",
            ]
          : [
              "Tell the insurer how you deliver and which products you sell or handle.",
              "Review delivery use, general liability and product liability with the insurer.",
              "Record confirmed coverage, effective/expiration dates and any exclusions.",
            ],
        "Provider",
        [sources.sba],
        {
          notice: "Complete with your chosen bank/insurer; requirements and costs vary.",
          dependencies: structure === "LLC" ? ["formation"] : [],
        },
      ),
    );
  list.push(
    step(
      "stripe",
      "Stripe account identity",
      "Payment account and payout bank ownership must match the actual business.",
      [
        "Open Stripe or use your existing account. Do not create a duplicate account merely to complete this checklist.",
        "Complete identity verification directly with Stripe; confirm legal name, ownership and payout bank.",
        "Record confirmation. This checklist does not change Stripe ownership or enable payments.",
      ],
      "Provider",
      [sources.stripe, sources.stripeSole],
      { dependencies: ["bank"] },
    ),
  );
  list.push(
    step(
      "books",
      "Bookkeeping and income-tax planning",
      "Maintain records for reporting, expenses and estimated taxes.",
      [
        "Choose a bookkeeping system and begin business expense and mileage records.",
        "Review estimated-income-tax and self-employment-tax obligations with the IRS guidance or your CPA.",
        "Record the process and responsible person. An LLC does not automatically reduce taxes; S corporation taxation is a separate CPA decision.",
      ],
      "Internal Document",
      [sources.income, sources.irsLLC],
      { feeCents: 0 },
    ),
  );
  list.push(
    step(
      "tax-ready",
      "Sales-tax calculation and filing readiness",
      "Registration, calculation, and filing/remittance are separate tasks.",
      [
        "Confirm tax registration, taxable products, delivery-charge treatment and sourcing with authoritative Illinois guidance.",
        "Review the provider calculation configuration without inferring a flat rate from ZIP alone.",
        "Confirm IDOR filing frequency, responsible person and remittance process; save the next deadline.",
        "Record the review. This wizard never changes existing checkout or tax calculations.",
      ],
      "Provider",
      [sources.salesTax, sources.stripeTax, sources.idor],
      { dependencies: ["illinois"], recurring: true },
    ),
  );
  if (p.products !== "SEALED")
    list.push(
      step(
        "product-review",
        "Product handling and labeling review",
        "Manufacturing, rebottling or relabeling changes the regulatory and insurance review.",
        [
          "Describe the actual product handling to the relevant agencies, insurer and professional adviser.",
          "Confirm product safety, labeling, storage and any permit requirements before operations.",
          "Record the reviewing authority, response and resolved requirements.",
        ],
        "Needs Verification",
        [sources.sba],
        { unknown: true },
      ),
    );
  if (p.transfers !== "NO")
    list.push(
      step(
        "transfer-review",
        "Existing business transfer review",
        "Assets, contracts and registrations cannot simply be relabeled.",
        [
          "List transferred assets and contracts with a qualified adviser.",
          "Confirm assignments, liabilities, tax treatment and which registrations must be new or amended.",
          "Keep the review and required consents. No transfers are performed by this wizard.",
        ],
        "Needs Verification",
        [sources.sba, sources.irsLLC],
        { unknown: true },
      ),
    );
  if (structure === "LLC") {
    list.push(
      step(
        "annual",
        "Set up annual-report tracking",
        "Illinois LLCs must keep annual state reports current.",
        [
          "Use the actual formation date to calculate the annual-report deadline, before the first day of the anniversary month.",
          "Confirm the state record and next deadline; standard report fee is $75, with processing or late fees additional.",
          "For an existing LLC, check that past reports are current. Record initial tracking setup; future reports remain visible after finishing.",
        ],
        "Online",
        [sources.annual, sources.annualLaw, sources.fees],
        { feeCents: 7500, recurring: true, dependencies: ["formation"] },
      ),
    );
    list.push(
      step(
        "boi",
        "Record BOI applicability",
        "The current FinCEN rule exempts U.S.-created entities from BOI reporting.",
        [
          "Confirm this is a U.S.-created LLC and review current FinCEN guidance.",
          "Record the exemption decision, source and review date. Do not submit an unnecessary BOI filing.",
          "Revisit applicability if the law or business circumstances change.",
        ],
        "Internal Document",
        [sources.boi],
        { feeCents: 0, allowNA: true },
      ),
    );
  }
  if (p.employees !== "NO") {
    list.push(
      step(
        "employer",
        "Employer and payroll registration",
        "Hiring triggers separate employer registration and payroll requirements.",
        [
          "Confirm IDES unemployment-insurance registration and applicable federal/state payroll tax accounts.",
          "Register through official agency instructions and record confirmations.",
          "Assign payroll withholding, deposits and reporting responsibilities before employing staff.",
        ],
        "Online",
        [sources.ides, sources.idor, sources.ein],
        { filing: true, approval: true, dependencies: ["ein"] },
      ),
    );
    list.push(
      step(
        "new-hires",
        "Set up new-hire reporting",
        "New employees require reporting under IDES instructions.",
        [
          "Review IDES reporting deadlines and register the reporting process.",
          "Assign responsibility and record each applicable hire's deadline outside this business-document checklist.",
          "Confirm the initial process; future reporting is an ongoing obligation.",
        ],
        "Online",
        [sources.hires],
        { recurring: true },
      ),
    );
    list.push(
      step(
        "workers",
        "Workers' compensation review",
        "Confirm legally required coverage before hiring.",
        [
          "Review Illinois requirements with your insurer.",
          "Arrange applicable coverage and save confirmation or a supported exemption decision.",
        ],
        "Provider",
        [sources.workers],
        { allowNA: true },
      ),
    );
  }
  return list;
}
export function planDefinitions(plan: BusinessPlan): StepDefinition[] {
  const list = definitions(plan.profile, plan.structure);
  for (const [key, task] of Object.entries(plan.tasks))
    if (key.startsWith("supplier:"))
      list.push(
        step(
          key,
          `Resale certificate — ${task.reference}`,
          "Maintain a separate record for this supplier.",
          [
            "Complete a certificate for this supplier using the registered legal owner.",
            "Record delivery in Filed/delivered date and supplier acceptance in Approval/acceptance date.",
            "Attach the certificate or describe the certificate and acceptance in an explicit attestation.",
          ],
          "Supplier",
          [sources.crt61, sources.resale],
          {
            feeCents: 0,
            approval: true,
            dependencies: ["illinois"],
            notice:
              "Give this certificate to your supplier; generally do not submit it to IDOR.",
          },
        ),
      );
  return list;
}
export function taskDeadlines(
  plan: BusinessPlan,
  definition: StepDefinition,
  task: TaskRecord,
) {
  const items: { label: string; date: string }[] = [];
  if (definition.key === "dba" && task.filedDate && !definition.unknown) {
    if (!task.publicationDates[0])
      items.push({ label: "First publication", date: addDays(task.filedDate, 15) });
    if (!task.proofReceived)
      items.push({
        label: "Clerk receives publication proof",
        date: addDays(task.filedDate, 50),
      });
  }
  if (definition.key === "annual" && plan.tasks.formation?.approvedDate)
    items.push({
      label: "Next annual report — confirm state record",
      date: task.deadline || annualDue(plan.tasks.formation.approvedDate),
    });
  else if (task.deadline && (task.status !== "COMPLETED" || definition.recurring))
    items.push({
      label: definition.recurring ? "Next recurring deadline" : definition.title,
      date: task.deadline,
    });
  return items;
}
export function progress(plan?: BusinessPlan) {
  const rows = plan
    ? planDefinitions(plan).map((d) => ({ ...d, task: plan.tasks[d.key] ?? emptyTask }))
    : [];
  const applicable = rows.filter(
    (r) =>
      !(
        r.task.status === "NOT_APPLICABLE" &&
        r.task.naReason.length >= 20 &&
        (!r.unknown || r.task.applicabilityConfirmed)
      ),
  );
  const complete = applicable.filter(
    (r) => r.task.status === "COMPLETED" && (!r.unknown || r.task.applicabilityConfirmed),
  );
  const deadlines = plan
    ? rows
        .flatMap((d) => taskDeadlines(plan, d, d.task))
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];
  return {
    total: applicable.length,
    completed: complete.length,
    percent: applicable.length
      ? Math.round((100 * complete.length) / applicable.length)
      : 0,
    pending: rows.filter((r) =>
      ["SUBMITTED", "AWAITING_APPROVAL"].includes(r.task.status),
    ).length,
    outstanding: applicable
      .filter((r) => !complete.includes(r))
      .map((r) => ({
        key: r.key,
        title: r.title,
        nextAction: r.task.nextAction || r.instructions[0],
      })),
    deadlines,
    knownCents: applicable
      .filter((r) => !r.recurring)
      .reduce((s, r) => s + (r.feeCents ?? 0), 0),
    recurringKnownCents: applicable
      .filter((r) => r.recurring)
      .reduce((s, r) => s + (r.feeCents ?? 0), 0),
    paidCents: rows.reduce(
      (s, r) => s + (r.task.actualPaidCents ?? 0) + (r.task.variablePaidCents ?? 0),
      0,
    ),
    unquoted: applicable.filter(
      (r) =>
        (r.feeCents === null && r.task.actualPaidCents === null) ||
        (r.variableCost && r.task.variablePaidCents === null),
    ).length,
  };
}
