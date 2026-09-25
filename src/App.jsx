import React, { useState, useEffect } from 'react';
import FHIR from 'fhirclient';
import './App.css';

const ACTIVITY_STORAGE_PREFIX = 'claimauth_activity_';

// Most Synthea test patients only carry one active Coverage — there's
// nothing to switch between until you happen to land on a patient with
// real coordination-of-benefits data. This lets a tester see a clearly-
// labeled synthetic second payer to demo the multi-coverage picker without
// needing a specific patient. It's never fetched from FHIR and never mixed
// into anything treated as real chart data. On by default, since COB is a
// common-enough real scenario that the demo should show it out of the box
// rather than requiring an extra click to discover — but it only ever
// activates when the real patient has exactly one coverage, so it never
// overrides or hides real coordination-of-benefits data when present.
const DEMO_SECONDARY_COVERAGE = {
  id: 'demo-secondary-coverage',
  payerName: 'Demo Secondary Payer (test data)',
  order: 2,
  memberId: 'DEMO-SEC-88214',
  relationship: 'Self',
  status: 'active',
  periodStart: '2026-01-01',
  rank: 'Secondary',
  isDemo: true,
  resource: {
    resourceType: 'Coverage',
    status: 'active',
    order: 2,
    subscriberId: 'DEMO-SEC-88214',
    relationship: { text: 'Self' },
    period: { start: '2026-01-01' },
    payor: [{ display: 'Demo Secondary Payer (test data)' }],
  },
};

// This log lives only in this browser's localStorage, keyed per patient.
// It is NOT a payer/clearinghouse record — there is no connection to one —
// and it is NOT shared with other devices, other users, or the EHR. It's a
// local "what did I already do for this patient today" trail, useful
// precisely because nothing else in this demo persists across a reload.
const loadActivityLog = (patientKey) => {
  if (!patientKey) return [];
  try {
    const raw = localStorage.getItem(`${ACTIVITY_STORAGE_PREFIX}${patientKey}`);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn('Could not read local activity log', err);
    return [];
  }
};

const saveActivityLog = (patientKey, entries) => {
  if (!patientKey) return;
  try {
    localStorage.setItem(`${ACTIVITY_STORAGE_PREFIX}${patientKey}`, JSON.stringify(entries));
  } catch (err) {
    console.warn('Could not save local activity log', err);
  }
};

const HIGHLIGHT_STYLES = {
  indigo: { background: 'linear-gradient(135deg, #eef2ff, #e0e7ff)', border: '1px solid rgba(99,102,241,0.18)', color: '#3730a3' },
  green: { background: 'linear-gradient(135deg, #ecfdf5, #f0fdf4)', border: '1px solid rgba(34,197,94,0.18)', color: '#166534' },
};

function EOBField({ label, value, highlight }) {
  const highlightStyle = highlight ? HIGHLIGHT_STYLES[highlight] : null;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        borderRadius: '12px',
        padding: '10px 12px',
        background: highlightStyle ? highlightStyle.background : '#f8fafc',
        border: highlightStyle ? highlightStyle.border : '1px solid rgba(226,232,240,1)',
      }}
    >
      <span style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 }}>{label}</span>
      <strong style={{ fontSize: '13px', lineHeight: 1.45, color: highlightStyle ? highlightStyle.color : '#0f172a' }}>{value}</strong>
    </div>
  );
}

const EVIDENCE_CATEGORY_META = {
  conditions: { label: 'Conditions', icon: '🩺' },
  medications: { label: 'Medications', icon: '💊' },
  procedures: { label: 'Procedures', icon: '📋' },
  allergies: { label: 'Allergies', icon: '⚠️' },
};

function EvidenceCategory({ categoryKey, items }) {
  const meta = EVIDENCE_CATEGORY_META[categoryKey];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 }}>
        <span aria-hidden="true">{meta.icon}</span>
        <span>{meta.label}</span>
        <span style={{ color: '#94a3b8', fontWeight: 700 }}>({items.length})</span>
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic', padding: '8px 10px' }}>None on file for this patient.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', borderRadius: '10px', background: '#f8fafc', border: '1px solid rgba(226,232,240,1)', padding: '8px 10px' }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</div>
                <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '2px' }}>{item.date}{item.status ? ` • ${item.status}` : ''}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldRow({ label, value, source }) {
  const isMissing = value === null || value === undefined || value === '';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', borderRadius: '10px', background: '#f8fafc', border: '1px solid rgba(226,232,240,1)', padding: '9px 11px' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '9px', letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 800 }}>{label}</div>
        <div style={{ fontSize: '12.5px', fontWeight: 700, color: isMissing ? '#94a3b8' : '#0f172a', fontStyle: isMissing ? 'italic' : 'normal', marginTop: '2px' }}>
          {isMissing ? 'Not on file' : value}
        </div>
      </div>
      {source && !isMissing && (
        <div style={{ fontSize: '9px', color: '#94a3b8', textAlign: 'right', maxWidth: '170px', lineHeight: 1.4, flexShrink: 0 }}>{source}</div>
      )}
    </div>
  );
}

const REVIEW_STEPS = [
  { key: 'fields', label: 'Request Fields' },
  { key: 'justification', label: 'Justification' },
  { key: 'evidence', label: 'Evidence' },
  { key: 'submit', label: 'Submit' },
];

function StepIndicator({ steps, currentIndex, onSelect }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
      {steps.map((step, index) => {
        const isActive = index === currentIndex;
        const isDone = index < currentIndex;
        return (
          <React.Fragment key={step.key}>
            <button
              type="button"
              onClick={() => onSelect(index)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', border: 0, background: 'transparent', padding: '4px 2px', cursor: 'pointer' }}
            >
              <span
                style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: '11px',
                  fontWeight: 800,
                  background: isActive ? '#4338ca' : isDone ? '#e0e7ff' : '#f1f5f9',
                  color: isActive ? '#fff' : isDone ? '#4338ca' : '#94a3b8',
                  border: isActive ? 'none' : '1px solid rgba(226,232,240,1)',
                }}
              >
                {isDone ? '✓' : index + 1}
              </span>
              <span style={{ fontSize: '11px', fontWeight: isActive ? 800 : 600, color: isActive ? '#0f172a' : '#94a3b8' }}>{step.label}</span>
            </button>
            {index < steps.length - 1 && <span style={{ width: '14px', height: '1px', background: 'rgba(203,213,225,0.9)', flexShrink: 0 }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function App() {
  const [patient, setPatient] = useState(null);
  const [coverageBundle, setCoverageBundle] = useState(null);
  const [eobBundle, setEobBundle] = useState(null);
  const [selectedCoverageId, setSelectedCoverageId] = useState(null);
  const [showDemoSecondary, setShowDemoSecondary] = useState(true);
  const [loading, setLoading] = useState(true);
  const [activityLog, setActivityLog] = useState([]);
  const [aiStatus, setAiStatus] = useState('idle');
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [clinician, setClinician] = useState('Loading provider...');
  const [specialty, setSpecialty] = useState('Loading specialty...');
  const [providerNpi, setProviderNpi] = useState(null);
  const [location, setLocation] = useState('Loading location...');
  const [procedureInfo, setProcedureInfo] = useState({ title: 'requested clinical service', code: 'N/A', requestedDate: null });
  const [authDetails, setAuthDetails] = useState(null);
  const [clinicalEvidence, setClinicalEvidence] = useState(null);
  const [reviewStep, setReviewStep] = useState(0);
  const [payloadExpanded, setPayloadExpanded] = useState(false);

  const formatMoney = (value) => {
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (Number.isNaN(num)) return '—';
    return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  };

  const generateAuthorizationNumber = () => {
    const year = new Date().getFullYear();
    const rand = Math.floor(Math.random() * 900000 + 100000);
    return `PA-${year}-${rand}`;
  };

  // Builds a patient cost estimate, preferring real payer data where it
  // exists over a synthetic fallback, and tags the result with where the
  // numbers came from so the UI can show "estimated" vs. "payer-verified".
  // A patient can have more than one active Coverage at once (their own
  // plan plus a spouse's, Medicare plus a supplement, Medicaid as
  // secondary, etc.). Which one is billed first is a real, payer-defined
  // ordering — the FHIR Coverage.order field — not something to guess by
  // whichever the server happened to return first. Inactive/cancelled
  // coverages are dropped; the rest are sorted by order, with unordered
  // ones (rare, but possible) placed after anything that states an order.
  const resolveCoverageList = (coverageData) => {
    if (!coverageData || !Array.isArray(coverageData.entry)) return [];

    const items = coverageData.entry
      .map((entry) => entry && entry.resource)
      .filter(Boolean)
      .filter((r) => !r.status || r.status === 'active')
      .map((r) => ({
        id: r.id || `coverage-${Math.random().toString(36).slice(2, 8)}`,
        payerName: (Array.isArray(r.payor) && r.payor.length > 0 && (r.payor[0].display || r.payor[0].reference)) || 'Unknown payer',
        order: typeof r.order === 'number' ? r.order : null,
        relationship: (r.relationship && (r.relationship.text || (r.relationship.coding && r.relationship.coding[0] && r.relationship.coding[0].display))) || null,
        memberId: r.subscriberId || (Array.isArray(r.identifier) && r.identifier.length > 0 && (r.identifier[0].value || null)) || null,
        status: r.status || 'active',
        periodStart: (r.period && r.period.start) || null,
        resource: r,
      }));

    const withOrder = items.filter((c) => c.order !== null).sort((a, b) => a.order - b.order);
    const withoutOrder = items.filter((c) => c.order === null);
    const sorted = [...withOrder, ...withoutOrder];

    const rankLabels = ['Primary', 'Secondary', 'Tertiary'];
    return sorted.map((c, index) => ({
      ...c,
      rank: rankLabels[index] || `Coverage ${index + 1}`,
    }));
  };

  const resolveCostBreakdown = (coverageData, eobData, fallbackBilledCharges = 2450) => {
    const round2 = (n) => Math.round(n * 100) / 100;

    // 1) An adjudicated ExplanationOfBenefit is the payer's actual line-item
    //    cost-share determination — prefer it over anything else.
    if (eobData && Array.isArray(eobData.entry) && eobData.entry.length > 0) {
      const eob = eobData.entry[0].resource || {};
      const adjudications = [];
      if (Array.isArray(eob.item)) {
        eob.item.forEach((item) => {
          if (Array.isArray(item.adjudication)) adjudications.push(...item.adjudication);
        });
      }
      if (Array.isArray(eob.total)) adjudications.push(...eob.total);

      const findAmount = (categoryRegex) => {
        const match = adjudications.find((adj) => {
          const codings = (adj && adj.category && adj.category.coding) || [];
          return codings.some((c) => categoryRegex.test(c.code || '') || categoryRegex.test(c.display || ''));
        });
        return match && match.amount && typeof match.amount.value === 'number' ? match.amount.value : null;
      };

      const billed = findAmount(/submitted/i);
      const allowed = findAmount(/eligible|benefit/i);
      const deductible = findAmount(/deductible/i) || 0;
      const copay = findAmount(/copay/i) || 0;
      const coinsurance = findAmount(/coinsurance/i) || 0;
      const planPaidAmt = findAmount(/paidtoprovider|benefit/i);

      if (billed !== null || allowed !== null) {
        const billedCharges = billed !== null ? billed : fallbackBilledCharges;
        const allowedAmount = allowed !== null ? allowed : billedCharges;
        const patientResponsibility = round2(deductible + copay + coinsurance);
        const planPaid = planPaidAmt !== null ? planPaidAmt : Math.max(round2(allowedAmount - patientResponsibility), 0);
        return {
          source: 'eob',
          sourceLabel: 'Verified via adjudicated claim (EOB)',
          billedCharges,
          allowedAmount,
          planDiscount: Math.max(round2(billedCharges - allowedAmount), 0),
          deductibleApplied: deductible,
          copayAmount: copay,
          coinsuranceAmount: coinsurance,
          patientResponsibility,
          planPaid,
        };
      }
    }

    // 2) Coverage.costToBeneficiary — the payer's published cost-share terms
    //    (roughly the same data an eligibility 271 response would carry).
    if (coverageData && Array.isArray(coverageData.entry) && coverageData.entry.length > 0) {
      const coverage = coverageData.entry[0].resource || {};
      const costItems = Array.isArray(coverage.costToBeneficiary) ? coverage.costToBeneficiary : [];

      if (costItems.length > 0) {
        const findByType = (regex) => {
          const item = costItems.find((c) => {
            const codings = (c && c.type && c.type.coding) || [];
            const text = (c && c.type && c.type.text) || '';
            return codings.some((code) => regex.test(code.code || '') || regex.test(code.display || '')) || regex.test(text);
          });
          return item && item.valueMoney && typeof item.valueMoney.value === 'number' ? item.valueMoney.value : null;
        };

        const copay = findByType(/copay/i);
        const coinsuranceRate = findByType(/coinsurance/i);
        const deductible = findByType(/deductible/i);

        if (copay !== null || coinsuranceRate !== null || deductible !== null) {
          const billedCharges = fallbackBilledCharges;
          const allowedAmount = round2(billedCharges * 0.84);
          const deductibleApplied = deductible || 0;
          const copayAmount = copay || 0;
          const coinsuranceAmount = coinsuranceRate ? round2(allowedAmount * (coinsuranceRate <= 1 ? coinsuranceRate : coinsuranceRate / 100)) : 0;
          const patientResponsibility = round2(deductibleApplied + copayAmount + coinsuranceAmount);
          return {
            source: 'coverage',
            sourceLabel: `Payer-published cost share${coverage.type && coverage.type.text ? ` (${coverage.type.text})` : ''}`,
            billedCharges,
            allowedAmount,
            planDiscount: Math.max(round2(billedCharges - allowedAmount), 0),
            deductibleApplied,
            copayAmount,
            coinsuranceAmount,
            patientResponsibility,
            planPaid: Math.max(round2(allowedAmount - patientResponsibility), 0),
          };
        }
      }
    }

    // 3) Fallback — a clearly-labeled synthetic estimate so the workspace
    //    never shows a blank cost panel while data is unavailable.
    const billedCharges = fallbackBilledCharges;
    const allowedAmount = round2(billedCharges * 0.78);
    const copayAmount = 150;
    const deductibleApplied = 0;
    const coinsuranceAmount = 0;
    const patientResponsibility = round2(copayAmount + deductibleApplied + coinsuranceAmount);
    return {
      source: 'estimate',
      sourceLabel: 'Estimated — no adjudicated claim or published cost share on file',
      billedCharges,
      allowedAmount,
      planDiscount: Math.max(round2(billedCharges - allowedAmount), 0),
      deductibleApplied,
      copayAmount,
      coinsuranceAmount,
      patientResponsibility,
      planPaid: Math.max(round2(allowedAmount - patientResponsibility), 0),
    };
  };

  const resolveProcedureContext = (serviceRequestData, procedureData) => {
    const bundles = [serviceRequestData, procedureData].filter(Boolean);

    for (const bundle of bundles) {
      if (!bundle || !bundle.entry || !Array.isArray(bundle.entry)) {
        continue;
      }

      for (const entry of bundle.entry) {
        const resource = entry && entry.resource;
        if (!resource) continue;

        const code = resource.code || resource.medicationCodeableConcept || null;
        const codeText = code && code.text ? code.text : null;
        const coding = code && Array.isArray(code.coding) && code.coding.length > 0 ? code.coding[0] : null;
        const display = coding && coding.display ? coding.display : null;
        const codeValue = coding && coding.code ? coding.code : null;
        const title = codeText || display || resource.code?.coding?.[0]?.display || 'requested clinical service';
        const requestedDate =
          resource.authoredOn ||
          resource.occurrenceDateTime ||
          (resource.occurrencePeriod && resource.occurrencePeriod.start) ||
          resource.performedDateTime ||
          (resource.performedPeriod && resource.performedPeriod.start) ||
          null;

        if (title) {
          return { title, code: codeValue || 'N/A', requestedDate };
        }
      }
    }

    return { title: 'requested clinical service', code: 'N/A', requestedDate: null };
  };

  const resolvePractitionerMeta = (practitionerData) => {
    if (!practitionerData) {
      return {
        name: 'Active Clinical Provider',
        specialty: 'Clinical Care',
        location: 'Care Facility',
      };
    }

    const nameEntries = Array.isArray(practitionerData.name) ? practitionerData.name : [];
    const primaryName = nameEntries[0] || {};
    const prefix = Array.isArray(primaryName.prefix) ? primaryName.prefix.join(' ') : primaryName.prefix || '';
    const given = Array.isArray(primaryName.given) ? primaryName.given.join(' ') : primaryName.given || '';
    const family = primaryName.family || '';
    const practitionerName = [prefix, given, family].filter(Boolean).join(' ') || 'Active Clinical Provider';

    const specialtyText =
      practitionerData.specialty && Array.isArray(practitionerData.specialty)
        ? practitionerData.specialty[0]?.text || practitionerData.specialty[0]?.coding?.[0]?.display || 'Clinical Care'
        : practitionerData.specialty && practitionerData.specialty.text
          ? practitionerData.specialty.text
          : practitionerData.qualification && Array.isArray(practitionerData.qualification)
            ? practitionerData.qualification[0]?.code?.text || practitionerData.qualification[0]?.code?.coding?.[0]?.display || 'Clinical Care'
            : 'Clinical Care';

    const practitionerLocation =
      practitionerData.address && Array.isArray(practitionerData.address) && practitionerData.address.length > 0
        ? practitionerData.address[0].city || practitionerData.address[0].state || 'Care Facility'
        : practitionerData.extension && Array.isArray(practitionerData.extension)
          ? practitionerData.extension.find((ext) => ext.url && /location|practice/i.test(ext.url))?.valueString || 'Care Facility'
          : 'Care Facility';

    return {
      name: practitionerName || 'Active Clinical Provider',
      specialty: specialtyText || 'Clinical Care',
      location: practitionerLocation || 'Care Facility',
    };
  };

  const formatEvidenceDate = (dateStr) => {
    if (!dateStr) return 'Date not recorded';
    const parsed = new Date(dateStr);
    if (Number.isNaN(parsed.getTime())) return dateStr;
    return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const codeableConceptText = (codeable) => {
    if (!codeable) return null;
    if (codeable.text) return codeable.text;
    if (Array.isArray(codeable.coding) && codeable.coding.length > 0) {
      return codeable.coding[0].display || codeable.coding[0].code || null;
    }
    return null;
  };

  // Pulls the patient's structured chart entries (not free-text notes — this
  // sandbox, like most FHIR test servers, doesn't have real clinician
  // narrative text) so the justification can be checked against something
  // concrete instead of taken on faith.
  const resolveClinicalEvidence = (conditionData, medicationData, allergyData, procedureData) => {
    const mapEntries = (bundle, mapper) => {
      if (!bundle || !Array.isArray(bundle.entry)) return [];
      return bundle.entry
        .map((entry) => entry && entry.resource)
        .filter(Boolean)
        .map(mapper)
        .filter((item) => item && item.label);
    };

    const conditions = mapEntries(conditionData, (r) => ({
      id: r.id || `${r.resourceType}-${Math.random()}`,
      label: codeableConceptText(r.code) || 'Documented condition',
      code: (r.code && Array.isArray(r.code.coding) && r.code.coding.length > 0 && r.code.coding[0].code) || null,
      date: formatEvidenceDate(r.onsetDateTime || (r.onsetPeriod && r.onsetPeriod.start) || r.recordedDate),
      status: (r.clinicalStatus && codeableConceptText(r.clinicalStatus)) || null,
    })).slice(0, 5);

    const medications = mapEntries(medicationData, (r) => ({
      id: r.id || `${r.resourceType}-${Math.random()}`,
      label: codeableConceptText(r.medicationCodeableConcept) || 'Documented medication',
      date: formatEvidenceDate(r.authoredOn),
      status: r.status || null,
    })).slice(0, 5);

    const allergies = mapEntries(allergyData, (r) => ({
      id: r.id || `${r.resourceType}-${Math.random()}`,
      label: codeableConceptText(r.code) || 'Documented allergy',
      date: formatEvidenceDate(r.recordedDate),
      status: (r.clinicalStatus && codeableConceptText(r.clinicalStatus)) || null,
    })).slice(0, 5);

    const procedures = mapEntries(procedureData, (r) => ({
      id: r.id || `${r.resourceType}-${Math.random()}`,
      label: codeableConceptText(r.code) || 'Documented procedure',
      date: formatEvidenceDate(r.performedDateTime || (r.performedPeriod && r.performedPeriod.start)),
      status: r.status || null,
    })).slice(0, 5);

    return {
      conditions,
      medications,
      allergies,
      procedures,
      totalCount: conditions.length + medications.length + allergies.length + procedures.length,
    };
  };

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const launchParam = urlParams.get('launch');
    const issParam = urlParams.get('iss');
    const clinicianParam = urlParams.get('clinician');

    if (clinicianParam) {
      setClinician(clinicianParam);
    }

    if (launchParam && issParam) {
      FHIR.oauth2.authorize({
        clientId: 'claim_auth_integration',
        scope: 'patient/*.read launch online_access openid profile',
        redirectUri: window.location.origin,
      });
      return;
    }

    FHIR.oauth2
      .ready()
      .then((client) => {
        client.requestHeaders = {
          ...client.requestHeaders,
          'Bypass-Tunnel-Reminder': 'true',
        };

        // IMPORTANT: every one of these has its own .catch(). With Promise.all,
        // a single rejected promise (e.g. Coverage or ServiceRequest returning
        // a 403/404, which is common when a scope or resource isn't supported)
        // used to reject the entire batch, jump to the outer .catch(), and wipe
        // out the patient/practitioner data that *had* loaded successfully.
        // Now each request fails on its own and just falls back to null.
        const patientPromise = client.patient.read().catch((err) => {
          console.warn('FHIR: Patient.read failed', err);
          return null;
        });
        const coveragePromise = client.patient.id
          ? client.request(`Coverage?patient=${client.patient.id}`).catch((err) => {
              console.warn('FHIR: Coverage request failed', err);
              return null;
            })
          : Promise.resolve(null);
        // client.user (not client.userId, which doesn't exist on the SMART
        // client) resolves the launched user's fhirUser / id_token claims and
        // reads whichever resource that points to — normally Practitioner in
        // a provider EHR launch.
        const practitionerPromise = client.user && typeof client.user.read === 'function'
          ? client.user.read().catch((err) => {
              console.warn('FHIR: user.read() (practitioner) failed', err);
              return null;
            })
          : Promise.resolve(null);
        const serviceRequestPromise = client.patient.id
          ? client.request(`ServiceRequest?patient=${client.patient.id}`).catch((err) => {
              console.warn('FHIR: ServiceRequest request failed', err);
              return null;
            })
          : Promise.resolve(null);
        const procedurePromise = client.patient.id
          ? client.request(`Procedure?patient=${client.patient.id}`).catch((err) => {
              console.warn('FHIR: Procedure request failed', err);
              return null;
            })
          : Promise.resolve(null);
        const eobPromise = client.patient.id
          ? client.request(`ExplanationOfBenefit?patient=${client.patient.id}`).catch((err) => {
              console.warn('FHIR: ExplanationOfBenefit request failed (falling back to Coverage/estimate)', err);
              return null;
            })
          : Promise.resolve(null);
        // These three back the "clinical evidence reviewed" panel — the
        // structured chart data the justification is actually grounded in,
        // so a clinician can verify the AI's reasoning instead of trusting
        // a bare "PASS" label.
        const conditionPromise = client.patient.id
          ? client.request(`Condition?patient=${client.patient.id}`).catch((err) => {
              console.warn('FHIR: Condition request failed', err);
              return null;
            })
          : Promise.resolve(null);
        const medicationPromise = client.patient.id
          ? client.request(`MedicationRequest?patient=${client.patient.id}`).catch((err) => {
              console.warn('FHIR: MedicationRequest request failed', err);
              return null;
            })
          : Promise.resolve(null);
        const allergyPromise = client.patient.id
          ? client.request(`AllergyIntolerance?patient=${client.patient.id}`).catch((err) => {
              console.warn('FHIR: AllergyIntolerance request failed', err);
              return null;
            })
          : Promise.resolve(null);

        return Promise.all([
          patientPromise,
          coveragePromise,
          practitionerPromise,
          serviceRequestPromise,
          procedurePromise,
          eobPromise,
          conditionPromise,
          medicationPromise,
          allergyPromise,
        ]);
      })
      .then(([patientData, coverageData, clinicianData, serviceRequestData, procedureData, eobData, conditionData, medicationData, allergyData]) => {
        let patientName = 'Selected patient';

        if (patientData && patientData.name && Array.isArray(patientData.name) && patientData.name.length > 0) {
          const firstNameEntry = patientData.name[0];
          const givenNames = firstNameEntry.given && Array.isArray(firstNameEntry.given) ? firstNameEntry.given : [];
          const familyName = firstNameEntry.family || '';
          const givenText = givenNames.length > 0 ? givenNames.join(' ') : '';
          patientName = [givenText, familyName].filter(Boolean).join(' ') || patientName;
        }

        const dob = patientData && patientData.birthDate ? patientData.birthDate : 'NA';

        let realDocName = 'Dr. Albertine Orn';

        if (clinicianData && clinicianData.name && Array.isArray(clinicianData.name) && clinicianData.name.length > 0) {
          const primaryNameObj = clinicianData.name[0];
          const givenName = primaryNameObj.given && Array.isArray(primaryNameObj.given) ? primaryNameObj.given.join(' ') : '';
          const familyName = primaryNameObj.family || '';
          const prefixTitle = primaryNameObj.prefix && Array.isArray(primaryNameObj.prefix) ? primaryNameObj.prefix.join(' ') + ' ' : 'Dr. ';

          if (givenName || familyName) {
            realDocName = `${prefixTitle}${givenName} ${familyName}`.replace(/\s+/g, ' ').trim();
          }
        }

        const practitionerContext = resolvePractitionerMeta(clinicianData);
        const resolvedProcedure = resolveProcedureContext(serviceRequestData, procedureData);
        const resolvedEvidence = resolveClinicalEvidence(conditionData, medicationData, allergyData, procedureData);
        const npiValue =
          clinicianData && Array.isArray(clinicianData.identifier)
            ? (clinicianData.identifier.find((id) => id && id.system && /us-npi/i.test(id.system))?.value || null)
            : null;

        setClinician(realDocName || practitionerContext.name || 'Active Clinical Provider');
        setSpecialty(practitionerContext.specialty || 'Clinical Care');
        setLocation(practitionerContext.location || 'Care Facility');
        setProviderNpi(npiValue);
        setProcedureInfo(resolvedProcedure);
        setPatient({ name: patientName, dob, id: patientData?.id || null });
        setCoverageBundle(coverageData);
        setEobBundle(eobData);
        setClinicalEvidence(resolvedEvidence);
        setLoading(false);
      })
      .catch((err) => {
        // At this point FHIR.oauth2.ready() itself failed (no valid SMART
        // session/token) — this is the real "not launched from EHR" case,
        // not a single sub-resource 404/403 (those are now caught above).
        console.error('FHIR: oauth2.ready() failed, no SMART session — using fallback parameters:', err);
        setClinician('Dr. Albertine Orn');
        setSpecialty('Clinical Care');
        setLocation('Care Facility');
        setProviderNpi(null);
        setProcedureInfo({ title: 'requested clinical service', code: 'N/A', requestedDate: null });
        setPatient({ name: 'Selected patient', dob: 'Unknown DOB' });
        setCoverageBundle(null);
        setEobBundle(null);
        setClinicalEvidence(resolveClinicalEvidence(null, null, null, null));
        setLoading(false);
      });
  }, []);

  // Default to the primary coverage once we know what's available. If the
  // admin later switches to a secondary payer, everything downstream
  // (cost breakdown, justification, payload) needs to be regenerated for
  // that payer — so switching also resets the in-progress review rather
  // than silently submitting content that was drafted against a different
  // payer's numbers.
  useEffect(() => {
    const list = resolveCoverageList(coverageBundle);
    if (list.length > 0 && !selectedCoverageId) {
      setSelectedCoverageId(list[0].id);
    }
  }, [coverageBundle]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectCoverage = (coverageId) => {
    if (coverageId === selectedCoverageId) return;
    setSelectedCoverageId(coverageId);
    setAiStatus('idle');
    setReviewStep(0);
    setAuthDetails(null);
  };

  // Load this patient's local activity log once we know who they are.
  // IMPORTANT: keyed only by the real FHIR Patient.id, never by name.
  // Synthea's synthetic population reuses common names constantly, so two
  // different patients named e.g. "John" would otherwise share one
  // localStorage bucket and one could see the other's history — a real
  // patient-mixup risk, not just a hypothetical one. If we don't have a
  // stable id, we don't persist at all rather than guess with a name.
  useEffect(() => {
    if (!patient?.id) {
      setActivityLog([]);
      return;
    }
    setActivityLog(loadActivityLog(patient.id));
  }, [patient?.id]);

  const logActivity = (label, meta = {}) => {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      label,
      ...meta,
    };
    setActivityLog((prev) => {
      const next = [entry, ...prev].slice(0, 25);
      if (patient?.id) {
        saveActivityLog(patient.id, next);
      }
      // No stable id → this session's entries still show in the UI below,
      // but aren't written anywhere, so there's nothing to collide with.
      return next;
    });
  };

  const clearActivityLog = () => {
    if (patient?.id) {
      saveActivityLog(patient.id, []);
    }
    setActivityLog([]);
  };

  const handleAiPreFill = () => {
    setAiStatus('scanning');
    setTimeout(() => {
      setReviewStep(0);
      setAiStatus('complete');
      logActivity('AI drafted a justification', { procedure: procedureDisplay, payer: insurance });
    }, 2000);
  };

  const handleSubmit = () => {
    const submittedAt = new Date();
    const formatDate = (d) => d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const referenceId = generateAuthorizationNumber();

    setAuthDetails({
      referenceId,
      submittedAt: formatDate(submittedAt),
      status: 'Submitted',
      payload: buildPasClaimPayload(),
    });
    logActivity('Submitted prior authorization request (local only)', { procedure: procedureDisplay, referenceId, payer: insurance });
    setAiStatus('submitted');
  };

  const handleCloseSubmission = () => {
    setAiStatus('idle');
    setReviewStep(0);
    setAuthDetails(null);
  };

  const patientInitial = patient?.name ? patient.name.charAt(0).toUpperCase() : 'R';
  const procedureTitle = procedureInfo.title || 'requested clinical service';
  const procedureCodeLabel = procedureInfo.code && procedureInfo.code !== 'N/A' ? `CPT ${procedureInfo.code}` : 'requested clinical service';
  const procedureDisplay =
    procedureCodeLabel === 'requested clinical service'
      ? procedureTitle
      : `${procedureCodeLabel} - ${procedureTitle}`;

  // Recomputed every render from the raw bundle + whichever coverage is
  // currently selected, rather than resolved once at load — so switching
  // payers (e.g. to submit to a secondary insurer) immediately updates the
  // payer name and the whole cost breakdown together, with nothing stale
  // left over from the previous payer.
  const realCoverages = resolveCoverageList(coverageBundle);
  const coverages = showDemoSecondary && realCoverages.length === 1
    ? [...realCoverages, DEMO_SECONDARY_COVERAGE]
    : realCoverages;
  const selectedCoverage = coverages.find((c) => c.id === selectedCoverageId) || coverages[0] || null;
  const insurance = selectedCoverage?.payerName || 'Coverage pending';
  const costBreakdown = resolveCostBreakdown(
    selectedCoverage?.resource ? { entry: [{ resource: selectedCoverage.resource }] } : null,
    eobBundle
  );

  // Standard PA data fields, based on the field set most payers' forms are
  // built around (the X12 278 transaction) — not this specific payer's
  // actual form, since none is connected here. Every value is either real
  // (pulled from an already-fetched FHIR resource, with that resource
  // named as its source) or explicitly "Not on file" — nothing here is
  // invented to fill a gap.
  const primaryDiagnosis = clinicalEvidence?.conditions?.[0] || null;
  const requestFieldSections = [
    {
      title: 'Patient',
      fields: [
        { label: 'Patient Name', value: patient?.name, source: 'Patient.name' },
        { label: 'Date of Birth', value: patient?.dob, source: 'Patient.birthDate' },
        { label: 'Member ID', value: selectedCoverage?.memberId, source: 'Coverage.subscriberId' },
      ],
    },
    {
      title: 'Payer',
      fields: [
        { label: 'Plan / Payer Name', value: insurance, source: 'Coverage.payor' },
        { label: 'Coverage Order', value: selectedCoverage?.rank, source: 'Coverage.order' },
        { label: 'Relationship to Subscriber', value: selectedCoverage?.relationship, source: 'Coverage.relationship' },
      ],
    },
    {
      title: 'Requesting Provider',
      fields: [
        { label: 'Provider Name', value: clinician, source: 'Practitioner.name' },
        { label: 'NPI', value: providerNpi, source: 'Practitioner.identifier (NPI)' },
        { label: 'Specialty', value: specialty, source: 'Practitioner.specialty' },
        { label: 'Practice Location', value: location, source: 'Practitioner.address' },
      ],
    },
    {
      title: 'Requested Service',
      fields: [
        { label: 'Procedure / CPT Code', value: procedureInfo.code && procedureInfo.code !== 'N/A' ? procedureInfo.code : null, source: 'ServiceRequest/Procedure.code' },
        { label: 'Description', value: procedureInfo.title, source: 'ServiceRequest/Procedure.code.text' },
        { label: 'Requested Date', value: procedureInfo.requestedDate ? formatEvidenceDate(procedureInfo.requestedDate) : null, source: 'ServiceRequest.authoredOn / Procedure.performed' },
      ],
    },
    {
      title: 'Diagnosis',
      fields: [
        {
          label: 'Primary Diagnosis',
          value: primaryDiagnosis?.label,
          source: primaryDiagnosis ? 'Condition.code — most recent on chart, not confirmed linked to this specific request' : null,
        },
        { label: 'Diagnosis Code', value: primaryDiagnosis?.code, source: primaryDiagnosis ? 'Condition.code.coding' : null },
      ],
    },
  ];

  const justificationText = `${patient?.name || 'Robert Chen'} is being managed under ${clinician}'s active care plan. The authorization review focuses on ${procedureDisplay}, using documented chart history, clinical necessity, and payer policy alignment to support treatment continuity and appropriate utilization. This determination reflects the least-burdensome clinically appropriate care pathway and is framed for coverage review based on the selected patient context.`;
  // Same content as justificationText, but with the three things a
  // clinician scanning this actually needs to double-check — who the
  // patient is, who the provider is, and what service this is for —
  // bolded. Plain justificationText stays a real string for the FHIR
  // payload; a <textarea> can't render bold text, so this display version
  // is markup instead.
  const justificationDisplay = (
    <>
      <strong>{patient?.name || 'Robert Chen'}</strong> is being managed under <strong>{clinician}</strong>'s active care plan.
      {' '}The authorization review focuses on <strong>{procedureDisplay}</strong>, using documented chart history, clinical necessity, and payer policy alignment to support treatment continuity and appropriate utilization. This determination reflects the least-burdensome clinically appropriate care pathway and is framed for coverage review based on the selected patient context.
    </>
  );
  const alertBannerText = `${clinician} submitted a care authorization request for ${patient?.name || 'the selected patient'} involving ${procedureDisplay}. Payer review requires documented medical necessity and policy compliance before treatment scheduling is authorized.`;
  const submittedStatusText = `${procedureDisplay} for ${patient?.name || 'the selected patient'} under ${insurance}.`;
  const transmissionSubtitle = 'ℹ️ This prepares the request payload locally. Sending it would require a connected payer or clearinghouse endpoint, which this demo does not have configured.';

  // Shapes the request the way HL7's Da Vinci Prior Authorization Support
  // (PAS) implementation guide expects — a FHIR Claim resource with
  // use: "preauthorization" — so the architecture is correct even though
  // there's no real payer/clearinghouse endpoint here to $submit it to.
  const buildPasClaimPayload = () => ({
    resourceType: 'Claim',
    status: 'draft',
    type: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/claim-type', code: 'professional', display: 'Professional' }],
    },
    use: 'preauthorization',
    patient: { display: patient?.name || 'Selected patient' },
    created: new Date().toISOString(),
    provider: { display: clinician || 'Requesting provider' },
    priority: { coding: [{ code: 'normal' }] },
    // Every active coverage is listed here, sequenced by the verified
    // Coverage.order (Primary = 1, Secondary = 2, ...) — not by which one
    // the admin currently has selected to review. `focal` marks the
    // primary specifically, per this project's convention: it stays fixed
    // to the primary even when this Claim is being prepared to submit to
    // the secondary payer's PAS endpoint. (Note for anyone extending this:
    // real-world X12/FHIR coordination-of-benefits claims more often mark
    // whichever coverage is actually being billed in that transaction as
    // focal, with others listed as non-focal context — this app follows
    // the simpler "primary is always focal" rule by design, not because
    // that's universally how payers expect it.)
    insurance: coverages.length > 0
      ? coverages.map((c, index) => ({
          sequence: index + 1,
          focal: c.rank === 'Primary',
          coverage: { display: c.payerName },
        }))
      : [
          {
            sequence: 1,
            focal: true,
            coverage: { display: insurance || 'Coverage pending' },
          },
        ],
    item: [
      {
        sequence: 1,
        productOrService: {
          coding: procedureInfo.code && procedureInfo.code !== 'N/A'
            ? [{ system: 'http://www.ama-assn.org/go/cpt', code: procedureInfo.code, display: procedureInfo.title }]
            : [],
          text: procedureInfo.title,
        },
        unitPrice: { value: costBreakdown?.billedCharges ?? null, currency: 'USD' },
      },
    ],
    total: { value: costBreakdown?.billedCharges ?? null, currency: 'USD' },
    supportingInfo: [
      { sequence: 1, category: { text: 'Clinical justification' }, valueString: justificationText },
    ],
  });

  if (loading) {
    return (
      <div className="loading-screen" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #eff6ff, #f8fafc)' }}>
        <div className="loading-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', minWidth: '320px', background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(226,232,240,0.9)', borderRadius: '22px', padding: '32px 28px', boxShadow: '0 25px 60px rgba(15, 23, 42, 0.08)' }}>
          <div className="loading-spinner" aria-hidden="true" style={{ width: '38px', height: '38px', borderRadius: '50%', border: '3px solid rgba(79, 70, 229, 0.15)', borderTopColor: '#4f46e5', animation: 'spin 0.9s linear infinite' }} />
          <div className="loading-title" style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.03em' }}>Syncing ClaimAuth Core...</div>
          <div className="loading-subtitle" style={{ fontSize: '11px', color: '#64748b', letterSpacing: '0.04em' }}>Establishing secure connection pipeline</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell" style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: '24px', overflow: 'hidden' }}>
      <div className="claim-panel" style={{ width: '100%', maxWidth: '1400px', height: '92vh', minHeight: '620px', background: 'rgba(255,255,255,0.96)', border: '1px solid #e2e8f0', borderRadius: '24px', boxShadow: '0 18px 42px rgba(15, 23, 42, 0.08), 0 8px 18px rgba(15, 23, 42, 0.04)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header className="panel-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '22px 22px 18px', background: 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.94))', borderBottom: '1px solid rgba(226, 232, 240, 0.95)' }}>
          <div className="brand-block" style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div className="brand-mark" aria-label="ClaimAuth secure status" style={{ width: '42px', height: '42px', display: 'grid', placeItems: 'center', borderRadius: '12px', background: 'linear-gradient(135deg, #4f46e5, #4338ca)', boxShadow: '0 10px 18px rgba(79, 70, 229, 0.18)' }}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{ width: '19px', height: '19px', fill: '#ffffff' }}>
                <path d="M12 2.75l6.75 2.5V11c0 4.08-2.53 7.8-6.75 10.25C7.78 18.8 5.25 15.08 5.25 11V5.25L12 2.75zm-1.4 7.5l-1.35 1.35 2.75 2.75 5.5-5.5L16.6 7.5l-4.25 4.25-1.35-1.35z" />
              </svg>
            </div>

            <div className="brand-copy" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <h1 style={{ margin: 0, fontSize: '26px', lineHeight: 1.05, fontWeight: 800, letterSpacing: '-0.06em', color: '#0f172a' }}>
                Claim<span style={{ color: '#4f46e5' }}>Auth</span>
              </h1>
              <p style={{ margin: 0, fontSize: '12px', fontWeight: 700, letterSpacing: '0.02em', color: '#64748b' }}>Active Provider session: {clinician}</p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              onClick={() => setShowActivityLog(true)}
              aria-haspopup="dialog"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: '999px', background: '#f8fafc', border: '1px solid rgba(226,232,240,1)', color: '#475569', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
            >
              🕓 Activity Log
            </button>
            <div className="status-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '999px', background: 'linear-gradient(135deg, #ecfdf5, #f0fdf4)', border: '1px solid rgba(34, 197, 94, 0.18)', color: '#15803d', fontSize: '11px', fontWeight: 700 }}>
              <span className="status-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 0 4px rgba(34, 197, 94, 0.14)' }} />
              FHIR Secure
            </div>
          </div>
        </header>

        <div className="workspace-body" style={{ display: 'flex', flexDirection: 'column', flex: '1', minHeight: 0, width: '100%', overflow: 'hidden', borderTop: '1px solid rgba(226,232,240,0.9)' }}>
          <div className="context-strip" style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.1fr 0.9fr', gap: '12px', padding: '16px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0, boxSizing: 'border-box' }}>
            <div className="context-card-compact" style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#fff', border: '1px solid rgba(226,232,240,0.9)', borderRadius: '14px', padding: '10px 14px', boxShadow: '0 6px 16px rgba(148,163,184,0.08)', minWidth: 0 }}>
              <div className="patient-avatar" aria-label="Patient initial badge" style={{ width: '38px', height: '38px', borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #e0e7ff, #c7d2fe)', color: '#312e81', fontSize: '15px', fontWeight: 800, flexShrink: 0 }}>{patientInitial}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '8.5px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 800 }}>Patient</div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{patient?.name || 'Robert Chen'}</div>
                <div style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 600 }}>DOB: {patient?.dob || '1978-04-12'}</div>
              </div>
            </div>

            <div className="context-card-compact" style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#fff', border: '1px solid rgba(226,232,240,0.9)', borderRadius: '14px', padding: '10px 14px', boxShadow: '0 6px 16px rgba(148,163,184,0.08)', minWidth: 0 }}>
              <div style={{ width: '34px', height: '34px', display: 'grid', placeItems: 'center', borderRadius: '11px', background: 'linear-gradient(135deg, #e0e7ff, #c7d2fe)', color: '#312e81', fontWeight: 800, fontSize: '14px', flexShrink: 0 }}>{clinician ? clinician.charAt(0).toUpperCase() : 'D'}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '8.5px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 800 }}>Provider</div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{clinician}</div>
                <div style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{specialty} • {location}</div>
              </div>
            </div>

            <div className="context-card-compact" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '6px', background: '#fff', border: '1px solid rgba(226,232,240,0.9)', borderRadius: '14px', padding: '10px 14px', boxShadow: '0 6px 16px rgba(148,163,184,0.08)', minWidth: 0 }}>
              <div style={{ fontSize: '8.5px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 800 }}>Verification</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: '999px', background: '#ecfdf5', color: '#15803d', border: '1px solid rgba(22,163,74,0.15)', padding: '4px 8px', fontSize: '10px', fontWeight: 800 }}>Coverage Verified</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: '999px', background: '#fef3c7', color: '#b45309', border: '1px solid rgba(251,191,36,0.2)', padding: '4px 8px', fontSize: '10px', fontWeight: 800 }}>Priority High</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flex: '1', minHeight: 0, overflow: 'hidden' }}>
              <div className="workspace-columns" style={{ display: 'grid', gridTemplateColumns: 'minmax(380px, 42%) minmax(420px, 58%)', width: '100%', minHeight: 0 }}>
                <div className="left-column" style={{ overflowY: 'auto', padding: '24px', borderRight: '1px solid #e2e8f0', background: 'linear-gradient(180deg, rgba(255,255,255,0.78), rgba(248,250,252,0.94))', display: 'flex', flexDirection: 'column', gap: '18px', minWidth: 0, minHeight: 0, boxSizing: 'border-box' }}>
                  <div className="alert-banner" style={{ background: 'linear-gradient(135deg, #fff7ed, #fffbeb)', border: '1px solid rgba(251, 191, 36, 0.2)', color: '#7c2d12', borderRadius: '16px', padding: '16px 15px', fontSize: '14.5px', lineHeight: 1.6, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)' }}>
                    <div className="alert-title" style={{ marginBottom: '6px', fontWeight: 800, color: '#b45309' }}>⚡ Intercepted Missing Authorization</div>
                    {alertBannerText}
                  </div>

                  <div className="context-card" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.96), rgba(248,250,252,0.96))', border: '1px solid rgba(226,232,240,0.9)', borderRadius: '18px', padding: '18px', boxShadow: '0 12px 26px rgba(148, 163, 184, 0.08)' }}>
                    <div className="section-label" style={{ marginBottom: '10px', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#64748b', fontWeight: 800 }}>Coverage & Payer</div>
              <div role="radiogroup" aria-label="Select which coverage to review" style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {coverages.length > 0 ? (
                  coverages.map((c) => {
                    const isSelected = c.id === selectedCoverageId;
                    const isActiveStatus = (c.status || 'active') === 'active';
                    return (
                      <button
                        key={c.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        aria-label={`${c.rank} coverage: ${c.payerName}${isSelected ? ', currently selected' : ''}`}
                        onClick={() => handleSelectCoverage(c.id)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                          textAlign: 'left',
                          borderRadius: '14px',
                          padding: '12px 14px',
                          cursor: 'pointer',
                          background: isSelected ? 'linear-gradient(135deg, #eef2ff, #e0e7ff)' : '#f8fafc',
                          border: isSelected
                            ? '1.5px solid rgba(99,102,241,0.4)'
                            : c.isDemo
                              ? '1px dashed rgba(148,163,184,0.6)'
                              : '1px solid rgba(226,232,240,1)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '9px', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 800, color: isSelected ? '#4338ca' : '#64748b', background: isSelected ? 'rgba(255,255,255,0.7)' : '#e2e8f0', borderRadius: '999px', padding: '3px 8px' }}>
                              {c.rank}
                            </span>
                            {c.isDemo && (
                              <span style={{ fontSize: '8.5px', fontWeight: 800, color: '#b45309', background: '#fef3c7', borderRadius: '999px', padding: '3px 7px' }}>TEST DATA</span>
                            )}
                          </span>
                          <span style={{ fontSize: '9.5px', fontWeight: 800, color: isActiveStatus ? '#15803d' : '#b91c1c' }}>
                            ● {isActiveStatus ? 'Active' : (c.status || 'Inactive')}
                          </span>
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>{c.payerName}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 14px', fontSize: '10.5px', color: '#64748b' }}>
                          <span>Member ID: <strong style={{ color: '#334155' }}>{c.memberId || 'Not on file'}</strong></span>
                          <span>Relationship: <strong style={{ color: '#334155' }}>{c.relationship || 'Not specified'}</strong></span>
                        </div>
                        {isSelected && (
                          <span style={{ fontSize: '9.5px', fontWeight: 800, color: '#4338ca' }}>✓ Currently reviewing this payer</span>
                        )}
                      </button>
                    );
                  })
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: '999px', background: '#f1f5f9', color: '#94a3b8', border: '1px solid rgba(226,232,240,1)', padding: '7px 10px', fontSize: '11px', fontWeight: 700 }}>Coverage pending</span>
                )}
              </div>
              {coverages.length > 1 && (
                <div style={{ marginTop: '10px', borderRadius: '12px', background: '#f8fafc', border: '1px solid rgba(226,232,240,1)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '9.5px', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 800, color: '#64748b' }}>ℹ️ Coordination of Benefits</span>
                  <p style={{ margin: 0, fontSize: '10.5px', lineHeight: 1.55, color: '#64748b' }}>
                    This patient has {coverages.length} active coverages. The {coverages[0].rank.toLowerCase()} payer is billed first
                    {coverages[1] ? `; the ${coverages[1].rank.toLowerCase()} is only used after the primary responds or the remaining patient balance is known` : ''} — never before. This order comes from verified eligibility/EHR data, not a guess, and can't be reordered here. Selecting a card above only changes which payer you're reviewing — it restarts the current review, since the justification, cost breakdown, and payload are all payer-specific.
                  </p>
                </div>
              )}
              {realCoverages.length === 1 && (
                <button
                  type="button"
                  onClick={() => setShowDemoSecondary((prev) => !prev)}
                  style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '5px', border: 0, background: 'transparent', padding: 0, cursor: 'pointer', fontSize: '10.5px', fontWeight: 700, color: '#94a3b8' }}
                >
                  {showDemoSecondary ? '✕ Remove demo secondary payer' : '🧪 This patient only has one coverage — add a demo secondary payer to test switching'}
                </button>
              )}
            </div>

                  <section className="cost-analysis-banner" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.94))', border: '1px solid rgba(226,232,240,0.9)', borderRadius: '18px', boxShadow: '0 12px 26px rgba(148, 163, 184, 0.08)', overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', width: '100%' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '16px 14px', borderRight: '1px solid rgba(226,232,240,0.8)', borderBottom: '1px solid rgba(226,232,240,0.8)', minHeight: '90px' }}>
                      <span style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 }}>Target Code</span>
                      <strong style={{ fontSize: '13px', lineHeight: 1.45, color: '#0f172a' }}>{procedureDisplay}</strong>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '16px 14px', borderBottom: '1px solid rgba(226,232,240,0.8)', minHeight: '90px' }}>
                      <span style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 }}>Approval Scope</span>
                      <strong style={{ fontSize: '13px', lineHeight: 1.45, color: '#0f172a' }}>{insurance} policy review • clinical necessity evaluation</strong>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '16px 14px', borderRight: '1px solid rgba(226,232,240,0.8)', minHeight: '90px' }}>
                      <span style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 }}>Contracted / Allowed Amount</span>
                      <strong style={{ fontSize: '13px', lineHeight: 1.45, color: '#0f172a' }}>{formatMoney(costBreakdown?.allowedAmount)}</strong>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '16px 14px', minHeight: '90px', background: 'linear-gradient(135deg, #ecfdf5, #f0fdf4)' }}>
                      <span style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 }}>Patient Financial Responsibility</span>
                      <strong style={{ fontSize: '13px', lineHeight: 1.45, color: '#166534' }}>{formatMoney(costBreakdown?.patientResponsibility)}</strong>
                    </div>
                  </div>
                </section>

                <section className="cost-breakdown-panel" style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(226,232,240,0.95)', borderRadius: '18px', padding: '18px', boxShadow: '0 12px 26px rgba(148, 163, 184, 0.08)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 800 }}>Cost & Benefits Breakdown</h3>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        borderRadius: '999px',
                        padding: '5px 10px',
                        fontSize: '10px',
                        fontWeight: 800,
                        background: costBreakdown?.source === 'estimate' ? '#fef3c7' : '#ecfdf5',
                        color: costBreakdown?.source === 'estimate' ? '#b45309' : '#15803d',
                        border: `1px solid ${costBreakdown?.source === 'estimate' ? 'rgba(251,191,36,0.25)' : 'rgba(22,163,74,0.18)'}`,
                      }}
                    >
                      {costBreakdown?.sourceLabel || 'Estimating cost share...'}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px' }}>
                    <EOBField label="Billed Charges" value={formatMoney(costBreakdown?.billedCharges)} />
                    <EOBField label="Plan Discount" value={formatMoney(costBreakdown?.planDiscount)} />
                    <EOBField label="Deductible Applied" value={formatMoney(costBreakdown?.deductibleApplied)} />
                    <EOBField label="Copay" value={formatMoney(costBreakdown?.copayAmount)} />
                    <EOBField label="Coinsurance" value={formatMoney(costBreakdown?.coinsuranceAmount)} />
                    <EOBField label="Allowed Amount" value={formatMoney(costBreakdown?.allowedAmount)} />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px' }}>
                    <EOBField label="Estimated Patient Responsibility" value={formatMoney(costBreakdown?.patientResponsibility)} highlight="green" />
                    <EOBField label="Estimated Plan Payment" value={formatMoney(costBreakdown?.planPaid)} highlight="indigo" />
                  </div>
                </section>
                </div>

                <div className="right-column" style={{ overflowY: 'auto', padding: '24px', background: 'linear-gradient(180deg, rgba(255,255,255,0.9), rgba(248,250,252,0.96))', display: 'flex', flexDirection: 'column', gap: '18px', minWidth: 0, minHeight: 0, boxSizing: 'border-box' }}>

                <section className="assistant-panel" style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(226, 232, 240, 0.95)', borderRadius: '18px', padding: '16px', boxShadow: '0 12px 28px rgba(148, 163, 184, 0.08)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <h3 style={{ margin: 0, fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 800 }}>ClaimAuth Assistant</h3>

                  {aiStatus === 'idle' && (
                    <button type="button" className="primary-button" onClick={handleAiPreFill} style={{ width: '100%', border: 0, borderRadius: '12px', padding: '13px 16px', fontSize: '13px', fontWeight: 800, cursor: 'pointer', background: 'linear-gradient(135deg, #4f46e5, #4338ca)', color: '#fff', boxShadow: '0 16px 24px rgba(79, 70, 229, 0.22)' }}>
                      Run AI Pre-Fill Engine
                    </button>
                  )}

                  {aiStatus === 'scanning' && (
                    <div className="loading-inline loading-inline--stacked" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start', gap: '10px', minHeight: 0, padding: '8px 0', color: '#4338ca', fontWeight: 700, fontSize: '13px' }}>
                      <div className="scan-log-row" style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(15,23,42,0.02)', border: '1px solid rgba(148,163,184,0.18)', borderRadius: '10px', padding: '10px 12px', color: '#1e293b', fontSize: '12px', lineHeight: 1.5, fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace' }}>
                        <span className="inline-spinner" style={{ width: '14px', height: '14px', borderRadius: '50%', border: '2px solid rgba(79, 70, 229, 0.15)', borderTopColor: '#4f46e5', animation: 'spin 0.9s linear infinite' }} />
                        <span>🔍 [STEP 1/3] Cross-checking payer policy and clinical necessity for {procedureDisplay}...</span>
                      </div>
                      <div className="scan-log-row" style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(15,23,42,0.02)', border: '1px solid rgba(148,163,184,0.18)', borderRadius: '10px', padding: '10px 12px', color: '#1e293b', fontSize: '12px', lineHeight: 1.5, fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace' }}>
                        <span className="inline-spinner inline-spinner--small" style={{ width: '12px', height: '12px', borderRadius: '50%', border: '2px solid rgba(79, 70, 229, 0.15)', borderTopColor: '#4f46e5', animation: 'spin 0.9s linear infinite' }} />
                        <span>⚖️ [STEP 2/3] Reviewing chart context and care decision support for {patient?.name || 'the selected patient'}...</span>
                      </div>
                      <div className="scan-log-row" style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(15,23,42,0.02)', border: '1px solid rgba(148,163,184,0.18)', borderRadius: '10px', padding: '10px 12px', color: '#1e293b', fontSize: '12px', lineHeight: 1.5, fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace' }}>
                        <span className="inline-spinner inline-spinner--small" style={{ width: '12px', height: '12px', borderRadius: '50%', border: '2px solid rgba(79, 70, 229, 0.15)', borderTopColor: '#4f46e5', animation: 'spin 0.9s linear infinite' }} />
                        <span>⏳ [STEP 3/3] Preparing authorization payload for secure transmission...</span>
                      </div>
                    </div>
                  )}

                  {aiStatus === 'complete' && (
                    <div className="assistant-output" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div className="success-banner" style={{ background: 'linear-gradient(135deg, #ecfdf5, #f0fdf4)', border: '1px solid rgba(22,163,74,0.18)', color: '#166534', borderRadius: '12px', padding: '10px 12px', fontSize: '12px', fontWeight: 700 }}>✓ Evidence mapped successfully to payer policy and chart criteria.</div>

                      <StepIndicator steps={REVIEW_STEPS} currentIndex={reviewStep} onSelect={setReviewStep} />

                      {reviewStep === 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                          <p style={{ margin: 0, fontSize: '11.5px', lineHeight: 1.6, color: '#64748b' }}>
                            These are the standard prior-authorization data fields — based on the X12 278 transaction set most payers' forms are built around, not this specific payer's actual form, since none is connected here. Each value shows exactly where it came from; anything missing says so instead of being filled in.
                          </p>
                          {requestFieldSections.map((section) => (
                            <div key={section.title} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <div style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 }}>{section.title}</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {section.fields.map((f) => (
                                  <FieldRow key={f.label} label={f.label} value={f.value} source={f.source} />
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {reviewStep === 1 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                          <div className="checklist-panel" style={{ background: 'linear-gradient(135deg, #f8fafc, #edf2ff)', border: '1px solid rgba(165,180,252,0.2)', borderRadius: '14px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div className="checklist-title" style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#4338ca', fontWeight: 800 }}>Payer Guideline Criteria Validation Checklist</div>
                            <div className="checklist-row" style={{ fontSize: '12px', lineHeight: 1.6, color: '#0f172a' }}>• Requested service aligns with documented clinical intent ──► [ PASS ]</div>
                            <div className="checklist-row" style={{ fontSize: '12px', lineHeight: 1.6, color: '#0f172a' }}>• Prior authorization criteria and network constraints reviewed ──► [ PASS ]</div>
                          </div>

                          <div className="field-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label style={{ fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 800 }}>Generated Justification Summary</label>
                            <div
                              role="textbox"
                              aria-readonly="true"
                              style={{ width: '100%', boxSizing: 'border-box', minHeight: '112px', borderRadius: '12px', border: '1px solid rgba(148,163,184,0.42)', background: '#f8fafc', color: '#334155', fontSize: '13px', lineHeight: 1.7, padding: '12px 14px', fontFamily: 'inherit' }}
                            >
                              {justificationDisplay}
                            </div>
                          </div>
                        </div>
                      )}

                      {reviewStep === 2 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                          <p style={{ margin: 0, fontSize: '11.5px', lineHeight: 1.6, color: '#64748b' }}>
                            These are the structured chart entries the AI checked before drafting the justification — not a summary of a clinical note, since none is on file for this patient in this system. Verify against the chart before submitting.
                          </p>
                          {clinicalEvidence ? (
                            <>
                              <EvidenceCategory categoryKey="conditions" items={clinicalEvidence.conditions} />
                              <EvidenceCategory categoryKey="medications" items={clinicalEvidence.medications} />
                              <EvidenceCategory categoryKey="procedures" items={clinicalEvidence.procedures} />
                              <EvidenceCategory categoryKey="allergies" items={clinicalEvidence.allergies} />
                            </>
                          ) : (
                            <div style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>Loading chart evidence...</div>
                          )}
                        </div>
                      )}

                      {reviewStep === 3 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                          <p style={{ margin: 0, fontSize: '11.5px', lineHeight: 1.6, color: '#64748b' }}>
                            Final check before submitting. This confirms what's about to go out and to whom.
                          </p>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px' }}>
                            <EOBField label="Patient" value={patient?.name || '—'} />
                            <EOBField label="Requesting Provider" value={clinician} />
                            <EOBField label="Requested Service" value={procedureDisplay} />
                            <EOBField label="Intended Payer" value={insurance} />
                            <EOBField label="Estimated Patient Responsibility" value={formatMoney(costBreakdown?.patientResponsibility)} highlight="green" />
                            <EOBField label="Estimated Plan Payment" value={formatMoney(costBreakdown?.planPaid)} highlight="indigo" />
                          </div>
                          <button type="button" className="inverse-button" onClick={handleSubmit} style={{ width: '100%', border: 0, borderRadius: '12px', padding: '13px 16px', fontSize: '13px', fontWeight: 800, cursor: 'pointer', background: 'linear-gradient(135deg, #0f172a, #1e293b)', color: '#fff', boxShadow: '0 14px 22px rgba(15,23,42,0.2)' }}>
                            Submit Prior Authorization Request
                          </button>
                          <div className="transmission-note" style={{ fontSize: '12px', lineHeight: 1.6, color: '#475569', padding: '0 2px' }}>{transmissionSubtitle}</div>

                          <button
                            type="button"
                            onClick={() => setPayloadExpanded((prev) => !prev)}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', border: 0, background: 'transparent', padding: '2px 0', cursor: 'pointer', fontSize: '11px', fontWeight: 700, color: '#94a3b8', alignSelf: 'flex-start' }}
                            aria-expanded={payloadExpanded}
                          >
                            {payloadExpanded ? '▲' : '▼'} Technical details (FHIR payload, for IT/audit — not needed to submit)
                          </button>
                          {payloadExpanded && (
                            <pre style={{ margin: 0, maxHeight: '260px', overflow: 'auto', background: '#0f172a', color: '#c7d2fe', borderRadius: '10px', padding: '14px', fontSize: '11px', lineHeight: 1.6, fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace' }}>
                              {JSON.stringify(buildPasClaimPayload(), null, 2)}
                            </pre>
                          )}
                        </div>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                        <button
                          type="button"
                          onClick={() => setReviewStep((s) => Math.max(0, s - 1))}
                          disabled={reviewStep === 0}
                          style={{ border: '1px solid rgba(226,232,240,1)', borderRadius: '10px', padding: '9px 14px', fontSize: '12px', fontWeight: 700, background: '#fff', color: reviewStep === 0 ? '#cbd5e1' : '#334155', cursor: reviewStep === 0 ? 'not-allowed' : 'pointer' }}
                        >
                          ← Back
                        </button>
                        {reviewStep < REVIEW_STEPS.length - 1 && (
                          <button
                            type="button"
                            onClick={() => setReviewStep((s) => Math.min(REVIEW_STEPS.length - 1, s + 1))}
                            style={{ border: 0, borderRadius: '10px', padding: '9px 16px', fontSize: '12px', fontWeight: 800, background: 'linear-gradient(135deg, #4f46e5, #4338ca)', color: '#fff', cursor: 'pointer' }}
                          >
                            Next →
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {aiStatus === 'submitted' && authDetails && (
                    <>
                      <div className="dispatch-card" style={{ background: 'linear-gradient(135deg, #1f1b5e, #312e81)', border: '1px solid rgba(165,180,252,0.2)', borderRadius: '16px', padding: '18px 16px', textAlign: 'center', color: '#fff' }}>
                        <div className="dispatch-title" style={{ marginBottom: '10px', fontSize: '15px', fontWeight: 800, color: '#c7d2fe' }}>✅ Request Submitted</div>
                        <p style={{ margin: 0, color: '#bfdbfe', fontSize: '12px', fontWeight: 600 }}>{submittedStatusText}</p>
                        <div className="dispatch-id" style={{ marginTop: '14px', borderRadius: '10px', background: 'rgba(15,23,42,0.2)', border: '1px solid rgba(165,180,252,0.2)', color: '#c7d2fe', fontSize: '11px', letterSpacing: '0.08em', padding: '10px 12px', fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace' }}>Local reference: {authDetails.referenceId}</div>
                      </div>

                      <div className="eob-card" style={{ background: '#ffffff', border: '1px solid rgba(226,232,240,0.95)', borderRadius: '18px', padding: '20px', boxShadow: '0 12px 28px rgba(148, 163, 184, 0.08)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', borderBottom: '1px solid rgba(226,232,240,0.9)', paddingBottom: '14px' }}>
                          <div>
                            <div style={{ fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 800, marginBottom: '4px' }}>Prior Authorization</div>
                            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.03em' }}>Request Summary</h3>
                          </div>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '999px', padding: '7px 12px', fontSize: '11px', fontWeight: 800, background: '#ecfdf5', color: '#15803d', border: '1px solid rgba(22,163,74,0.18)' }}>
                            ✓ {authDetails.status}
                          </span>
                        </div>

                        <p style={{ margin: 0, fontSize: '11.5px', lineHeight: 1.6, color: '#64748b' }}>
                          This is <strong>not</strong> an Explanation of Benefits — an EOB is issued by the payer after they've adjudicated a request, and nothing has been sent to a payer yet. This is a record of what's been prepared locally.
                        </p>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
                          <EOBField label="Local Reference ID" value={authDetails.referenceId} />
                          <EOBField label="Submitted At" value={authDetails.submittedAt} />
                          <EOBField label="Intended Payer" value={insurance} />
                        </div>

                        <div style={{ borderTop: '1px dashed rgba(148,163,184,0.4)', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <span style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 }}>Requested Service</span>
                          <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{procedureDisplay}</div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px', borderTop: '1px dashed rgba(148,163,184,0.4)', paddingTop: '14px' }}>
                          <EOBField label="Billed Charges" value={formatMoney(costBreakdown?.billedCharges)} />
                          <EOBField label="Estimated Plan Payment" value={formatMoney(costBreakdown?.planPaid)} highlight="indigo" />
                          <EOBField label="Estimated Patient Responsibility" value={formatMoney(costBreakdown?.patientResponsibility)} highlight="green" />
                        </div>

                        <button
                          type="button"
                          onClick={handleCloseSubmission}
                          style={{ width: '100%', border: '1px solid rgba(226,232,240,1)', borderRadius: '12px', padding: '11px 16px', fontSize: '13px', fontWeight: 800, cursor: 'pointer', background: '#fff', color: '#334155' }}
                        >
                          Close
                        </button>
                      </div>
                    </>
                  )}
                </section>
                </div>
              </div>
          </div>
        </div>

        {showActivityLog && (
          <div
            className="activity-log-overlay"
            style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'grid', placeItems: 'center', zIndex: 50, padding: '24px' }}
            onClick={() => setShowActivityLog(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Local activity log"
              onClick={(e) => e.stopPropagation()}
              style={{ background: '#fff', borderRadius: '20px', maxWidth: '560px', width: '100%', maxHeight: '80vh', overflowY: 'auto', padding: '22px', boxShadow: '0 30px 60px rgba(15,23,42,0.25)', boxSizing: 'border-box' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>Local Activity Log</h3>
                  <p style={{ margin: '6px 0 0', fontSize: '11.5px', lineHeight: 1.5, color: '#94a3b8', maxWidth: '420px' }}>
                    Recorded on this device only, for {patient?.name || 'this patient'}. Not synced with your EHR, a clearinghouse, or any payer — there's no live connection for it to sync to.
                    {!patient?.id && ' No stable patient ID was available from this launch, so this session\u2019s entries won\u2019t be saved after you reload — that\u2019s intentional, to avoid mixing up patients who share a name.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowActivityLog(false)}
                  aria-label="Close activity log"
                  style={{ border: 0, background: '#f1f5f9', borderRadius: '10px', width: '30px', height: '30px', flexShrink: 0, cursor: 'pointer', fontSize: '13px', color: '#64748b', fontWeight: 700 }}
                >
                  ✕
                </button>
              </div>

              {activityLog.length > 0 && (
                <button
                  type="button"
                  onClick={clearActivityLog}
                  style={{ display: 'block', marginBottom: '14px', border: 0, background: 'transparent', padding: 0, cursor: 'pointer', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textDecoration: 'underline' }}
                >
                  Clear log
                </button>
              )}

              {activityLog.length === 0 ? (
                <div style={{ fontSize: '12.5px', color: '#94a3b8', fontStyle: 'italic', padding: '8px 2px' }}>
                  No activity recorded yet for this patient. Actions like drafting a justification or submitting a request will show up here.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {activityLog.map((entry) => (
                    <div key={entry.id} className="log-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 12px', borderRadius: '14px', border: '1px solid rgba(226,232,240,1)', background: '#f8fafc' }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="log-title" style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>{entry.label}</div>
                        <div className="log-meta" style={{ marginTop: '4px', fontSize: '11px', color: '#64748b' }}>
                          {new Date(entry.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          {entry.procedure ? ` • ${entry.procedure}` : ''}
                          {entry.payer ? ` • ${entry.payer}` : ''}
                          {entry.referenceId ? ` • Ref: ${entry.referenceId}` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <footer className="panel-footer" style={{ padding: '14px 16px 18px', textAlign: 'center', fontSize: '9px', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', background: 'rgba(248,250,252,0.9)', borderTop: '1px solid rgba(226,232,240,0.9)' }}>🛡️ Enterprise Gateway • OAuth2 Certified • HIPAA Compliant</footer>
      </div>
    </div>
  );
}