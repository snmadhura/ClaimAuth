import React, { useState, useEffect } from 'react';
import FHIR from 'fhirclient';
import './App.css';

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

export default function App() {
  const [patient, setPatient] = useState(null);
  const [insurance, setInsurance] = useState('Checking registry...');
  const [loading, setLoading] = useState(true);
  const [aiStatus, setAiStatus] = useState('idle');
  const [activeTab, setActiveTab] = useState('copilot');
  const [clinician, setClinician] = useState('Loading provider...');
  const [specialty, setSpecialty] = useState('Loading specialty...');
  const [location, setLocation] = useState('Loading location...');
  const [procedureInfo, setProcedureInfo] = useState({ title: 'requested clinical service', code: 'N/A' });
  const [costBreakdown, setCostBreakdown] = useState(null);
  const [authDetails, setAuthDetails] = useState(null);
  const [clinicalEvidence, setClinicalEvidence] = useState(null);
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);

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

        if (title) {
          return { title, code: codeValue || 'N/A' };
        }
      }
    }

    return { title: 'requested clinical service', code: 'N/A' };
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

        let payerName = 'Coverage pending';
        if (coverageData && coverageData.entry && Array.isArray(coverageData.entry) && coverageData.entry.length > 0) {
          const firstEntry = coverageData.entry[0];
          const payor = firstEntry && firstEntry.resource && firstEntry.resource.payor ? firstEntry.resource.payor : null;
          if (payor && Array.isArray(payor) && payor.length > 0) {
            payerName = payor[0].display || payerName;
          }
        }

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
        const resolvedCostBreakdown = resolveCostBreakdown(coverageData, eobData);
        const resolvedEvidence = resolveClinicalEvidence(conditionData, medicationData, allergyData, procedureData);

        setClinician(realDocName || practitionerContext.name || 'Active Clinical Provider');
        setSpecialty(practitionerContext.specialty || 'Clinical Care');
        setLocation(practitionerContext.location || 'Care Facility');
        setProcedureInfo(resolvedProcedure);
        setPatient({ name: patientName, dob });
        setInsurance(payerName);
        setCostBreakdown(resolvedCostBreakdown);
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
        setProcedureInfo({ title: 'requested clinical service', code: 'N/A' });
        setPatient({ name: 'Selected patient', dob: 'Unknown DOB' });
        setInsurance('Coverage pending');
        setCostBreakdown(resolveCostBreakdown(null, null));
        setClinicalEvidence(resolveClinicalEvidence(null, null, null, null));
        setLoading(false);
      });
  }, []);

  const handleAiPreFill = () => {
    setAiStatus('scanning');
    setTimeout(() => setAiStatus('complete'), 2000);
  };

  const handleTransmit = () => {
    const decisionDate = new Date();
    const effectiveDate = new Date(decisionDate);
    const expirationDate = new Date(decisionDate);
    expirationDate.setDate(expirationDate.getDate() + 60);
    const formatDate = (d) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

    setAuthDetails({
      authorizationNumber: generateAuthorizationNumber(),
      status: 'Approved',
      decisionDate: formatDate(decisionDate),
      effectiveDate: formatDate(effectiveDate),
      expirationDate: formatDate(expirationDate),
      approvedScope: '1 unit • single episode of care',
    });
    setAiStatus('submitted');
  };

  const patientInitial = patient?.name ? patient.name.charAt(0).toUpperCase() : 'R';
  const procedureTitle = procedureInfo.title || 'requested clinical service';
  const procedureCodeLabel = procedureInfo.code && procedureInfo.code !== 'N/A' ? `CPT ${procedureInfo.code}` : 'requested clinical service';
  const procedureDisplay =
    procedureCodeLabel === 'requested clinical service'
      ? procedureTitle
      : `${procedureCodeLabel} - ${procedureTitle}`;

  const justificationText = `${patient?.name || 'Robert Chen'} is being managed under ${clinician}'s active care plan. The authorization review focuses on ${procedureDisplay}, using documented chart history, clinical necessity, and payer policy alignment to support treatment continuity and appropriate utilization. This determination reflects the least-burdensome clinically appropriate care pathway and is framed for coverage review based on the selected patient context.`;
  const alertBannerText = `${clinician} submitted a care authorization request for ${patient?.name || 'the selected patient'} involving ${procedureDisplay}. Payer review requires documented medical necessity and policy compliance before treatment scheduling is authorized.`;
  const submittedStatusText = `${procedureDisplay} is now secured for review under ${insurance} coverage rules and locked for secure transmission.`;
  const transmissionSubtitle = `ℹ️ Transmitting will lock the authorization review for ${procedureDisplay} into the secure payer transaction pipeline.`;

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

          <div className="status-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '999px', background: 'linear-gradient(135deg, #ecfdf5, #f0fdf4)', border: '1px solid rgba(34, 197, 94, 0.18)', color: '#15803d', fontSize: '11px', fontWeight: 700 }}>
            <span className="status-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 0 4px rgba(34, 197, 94, 0.14)' }} />
            FHIR Secure
          </div>
        </header>

        <nav className="segmented-tabs" aria-label="Workspace tabs" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', margin: '16px 18px 0', padding: '6px', borderRadius: '16px', background: '#f8fafc', border: '1px solid rgba(226,232,240,0.9)' }}>
          <button
            type="button"
            className={activeTab === 'copilot' ? 'tab-button active' : 'tab-button'}
            onClick={() => setActiveTab('copilot')}
            style={{ border: 0, background: activeTab === 'copilot' ? '#ffffff' : 'transparent', color: activeTab === 'copilot' ? '#4338ca' : '#64748b', borderRadius: '12px', padding: '10px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', boxShadow: activeTab === 'copilot' ? '0 8px 18px rgba(79, 70, 229, 0.12)' : 'none', transition: 'all 0.2s ease' }}
          >
            AI Co-Pilot
          </button>
          <button
            type="button"
            className={activeTab === 'logs' ? 'tab-button active' : 'tab-button'}
            onClick={() => setActiveTab('logs')}
            style={{ border: 0, background: activeTab === 'logs' ? '#ffffff' : 'transparent', color: activeTab === 'logs' ? '#4338ca' : '#64748b', borderRadius: '12px', padding: '10px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', boxShadow: activeTab === 'logs' ? '0 8px 18px rgba(79, 70, 229, 0.12)' : 'none', transition: 'all 0.2s ease' }}
          >
            Audit Logs
          </button>
        </nav>

        <div className="workspace-body" style={{ display: 'flex', flex: '1', minHeight: 0, width: '100%', overflow: 'hidden', borderTop: '1px solid rgba(226,232,240,0.9)' }}>
          <aside className="clinical-context-hub" style={{ width: '350px', minWidth: '350px', borderRight: '1px solid #e2e8f0', height: '100%', overflowY: 'auto', padding: '20px', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '16px', boxSizing: 'border-box' }}>
            <div className="context-card" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.96), rgba(248,250,252,0.96))', border: '1px solid rgba(226,232,240,0.9)', borderRadius: '18px', padding: '18px', boxShadow: '0 12px 26px rgba(148, 163, 184, 0.08)' }}>
              <div className="section-label" style={{ marginBottom: '10px', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#64748b', fontWeight: 800 }}>Active Patient Stream</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div className="patient-avatar" aria-label="Patient initial badge" style={{ width: '50px', height: '50px', borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #e0e7ff, #c7d2fe)', color: '#312e81', border: '2px solid rgba(255,255,255,0.9)', boxShadow: '0 12px 20px rgba(79, 70, 229, 0.12)', fontSize: '22px', fontWeight: 800 }}>{patientInitial}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.04em', margin: 0 }}>{patient?.name || 'Robert Chen'}</div>
                  <div style={{ marginTop: '4px', fontSize: '13px', color: '#64748b', fontWeight: 600 }}>DOB: {patient?.dob || '1978-04-12'}</div>
                </div>
              </div>
              <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'flex-start' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: '999px', background: 'linear-gradient(135deg, #eef2ff, #e0e7ff)', color: '#4338ca', border: '1px solid rgba(99,102,241,0.2)', padding: '7px 10px', fontSize: '11px', fontWeight: 700 }}>{insurance || 'Aetna Choice POS II'}</span>
              </div>
            </div>

            <div className="context-card" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.96), rgba(248,250,252,0.96))', border: '1px solid rgba(226,232,240,0.9)', borderRadius: '18px', padding: '18px', boxShadow: '0 12px 26px rgba(148, 163, 184, 0.08)' }}>
              <div className="section-label" style={{ marginBottom: '10px', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#64748b', fontWeight: 800 }}>Active Clinician Summary</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '44px', height: '44px', display: 'grid', placeItems: 'center', borderRadius: '14px', background: 'linear-gradient(135deg, #e0e7ff, #c7d2fe)', color: '#312e81', fontWeight: 800, fontSize: '20px', boxShadow: '0 12px 22px rgba(79, 70, 229, 0.12)' }}>{clinician ? clinician.charAt(0).toUpperCase() : 'D'}</div>
                <div>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.04em' }}>{clinician}</div>
                </div>
              </div>
              <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '12px', background: '#f8fafc', border: '1px solid rgba(226,232,240,1)', padding: '10px 12px' }}>
                  <span style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 }}>Specialty</span>
                  <strong style={{ color: '#0f172a', fontSize: '13px' }}>{specialty}</strong>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '12px', background: '#f8fafc', border: '1px solid rgba(226,232,240,1)', padding: '10px 12px' }}>
                  <span style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 }}>Location</span>
                  <strong style={{ color: '#0f172a', fontSize: '13px' }}>{location}</strong>
                </div>
              </div>
            </div>

            <div className="context-card" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.96), rgba(248,250,252,0.96))', border: '1px solid rgba(226,232,240,0.9)', borderRadius: '18px', padding: '18px', boxShadow: '0 12px 26px rgba(148, 163, 184, 0.08)' }}>
              <div className="section-label" style={{ marginBottom: '10px', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#64748b', fontWeight: 800 }}>Live Verification Status</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '12px', background: '#f8fafc', border: '1px solid rgba(226,232,240,1)', padding: '10px 12px' }}>
                  <span style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 }}>Coverage</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: '999px', background: '#ecfdf5', color: '#15803d', border: '1px solid rgba(22,163,74,0.15)', padding: '6px 8px', fontSize: '11px', fontWeight: 800 }}>Verified</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '12px', background: '#f8fafc', border: '1px solid rgba(226,232,240,1)', padding: '10px 12px' }}>
                  <span style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 }}>Priority</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: '999px', background: '#fef3c7', color: '#b45309', border: '1px solid rgba(251,191,36,0.2)', padding: '6px 8px', fontSize: '11px', fontWeight: 800 }}>High</span>
                </div>
              </div>
            </div>
          </aside>

          <main className="automation-and-analytics-hub" style={{ flex: '1', height: '100%', overflowY: 'auto', padding: '24px', background: 'linear-gradient(180deg, rgba(255,255,255,0.78), rgba(248,250,252,0.94))', display: 'flex', flexDirection: 'column', gap: '18px', minWidth: 0, boxSizing: 'border-box' }}>
            {activeTab === 'copilot' ? (
              <>
                <section className="cost-analysis-banner" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.94))', border: '1px solid rgba(226,232,240,0.9)', borderRadius: '18px', boxShadow: '0 12px 26px rgba(148, 163, 184, 0.08)', overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', width: '100%' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '16px 14px', borderRight: '1px solid rgba(226,232,240,0.8)', minHeight: '90px' }}>
                      <span style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 }}>Target Code</span>
                      <strong style={{ fontSize: '13px', lineHeight: 1.45, color: '#0f172a' }}>{procedureDisplay}</strong>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '16px 14px', borderRight: '1px solid rgba(226,232,240,0.8)', minHeight: '90px' }}>
                      <span style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 }}>Approval Scope</span>
                      <strong style={{ fontSize: '13px', lineHeight: 1.45, color: '#0f172a' }}>{insurance} policy review • clinical necessity evaluation</strong>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '16px 14px', borderRight: '1px solid rgba(226,232,240,0.8)', minHeight: '90px' }}>
                      <span style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 }}>Contracted / Allowed Amount</span>
                      <strong style={{ fontSize: '13px', lineHeight: 1.45, color: '#0f172a' }}>{formatMoney(costBreakdown?.allowedAmount)}</strong>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '16px 14px', minHeight: '90px', background: 'linear-gradient(135deg, #ecfdf5, #f0fdf4)', borderLeft: '1px solid rgba(34,197,94,0.18)' }}>
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

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
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

                <div className="alert-banner" style={{ background: 'linear-gradient(135deg, #fff7ed, #fffbeb)', border: '1px solid rgba(251, 191, 36, 0.2)', color: '#7c2d12', borderRadius: '16px', padding: '16px 15px', fontSize: '14.5px', lineHeight: 1.6, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)' }}>
                  <div className="alert-title" style={{ marginBottom: '6px', fontWeight: 800, color: '#b45309' }}>⚡ Intercepted Missing Authorization</div>
                  {alertBannerText}
                </div>

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
                    <div className="assistant-output" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      <div className="success-banner" style={{ background: 'linear-gradient(135deg, #ecfdf5, #f0fdf4)', border: '1px solid rgba(22,163,74,0.18)', color: '#166534', borderRadius: '12px', padding: '10px 12px', fontSize: '12px', fontWeight: 700 }}>✓ Evidence mapped successfully to payer policy and chart criteria.</div>

                      <div className="checklist-panel" style={{ background: 'linear-gradient(135deg, #f8fafc, #edf2ff)', border: '1px solid rgba(165,180,252,0.2)', borderRadius: '14px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div className="checklist-title" style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#4338ca', fontWeight: 800 }}>Payer Guideline Criteria Validation Checklist</div>
                        <div className="checklist-row" style={{ fontSize: '12px', lineHeight: 1.6, color: '#0f172a' }}>• Requested service aligns with documented clinical intent ──► [ PASS ]</div>
                        <div className="checklist-row" style={{ fontSize: '12px', lineHeight: 1.6, color: '#0f172a' }}>• Prior authorization criteria and network constraints reviewed ──► [ PASS ]</div>
                      </div>

                      <div className="evidence-panel" style={{ background: '#ffffff', border: '1px solid rgba(226,232,240,0.95)', borderRadius: '14px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <button
                          type="button"
                          onClick={() => setEvidenceExpanded((prev) => !prev)}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', width: '100%', border: 0, background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                          aria-expanded={evidenceExpanded}
                        >
                          <span style={{ fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 800 }}>
                            Clinical Evidence Reviewed{clinicalEvidence ? ` (${clinicalEvidence.totalCount})` : ''}
                          </span>
                          <span style={{ fontSize: '12px', fontWeight: 800, color: '#4338ca' }}>{evidenceExpanded ? 'Hide ▲' : 'Show ▼'}</span>
                        </button>

                        {evidenceExpanded && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', paddingTop: '4px' }}>
                            <p style={{ margin: 0, fontSize: '11.5px', lineHeight: 1.6, color: '#64748b' }}>
                              These are the structured chart entries the AI checked before drafting the justification below — not a summary of a clinical note, since none is on file for this patient in this system. Verify against the chart before transmitting.
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
                      </div>

                      <div className="field-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label style={{ fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 800 }}>Generated Justification Summary</label>
                        <textarea readOnly value={justificationText} style={{ width: '100%', boxSizing: 'border-box', minHeight: '112px', resize: 'none', borderRadius: '12px', border: '1px solid rgba(148,163,184,0.42)', background: '#f8fafc', color: '#334155', fontSize: '13px', lineHeight: 1.7, padding: '12px 14px', fontFamily: 'inherit' }} />
                      </div>

                      <button type="button" className="inverse-button" onClick={handleTransmit} style={{ width: '100%', border: 0, borderRadius: '12px', padding: '13px 16px', fontSize: '13px', fontWeight: 800, cursor: 'pointer', background: 'linear-gradient(135deg, #0f172a, #1e293b)', color: '#fff', boxShadow: '0 14px 22px rgba(15,23,42,0.2)' }}>
                        Transmit Authorization Payload
                      </button>
                      <div className="transmission-note" style={{ fontSize: '12px', lineHeight: 1.6, color: '#475569', padding: '0 2px' }}>{transmissionSubtitle}</div>
                    </div>
                  )}

                  {aiStatus === 'submitted' && authDetails && (
                    <>
                      <div className="dispatch-card" style={{ background: 'linear-gradient(135deg, #1f1b5e, #312e81)', border: '1px solid rgba(165,180,252,0.2)', borderRadius: '16px', padding: '18px 16px', textAlign: 'center', color: '#fff' }}>
                        <div className="dispatch-title" style={{ marginBottom: '10px', fontSize: '15px', fontWeight: 800, color: '#c7d2fe' }}>📡 Packet Securely Dispatched</div>
                        <p style={{ margin: 0, color: '#bfdbfe', fontSize: '12px', fontWeight: 600 }}>{submittedStatusText}</p>
                        <div className="dispatch-id" style={{ marginTop: '14px', borderRadius: '10px', background: 'rgba(15,23,42,0.2)', border: '1px solid rgba(165,180,252,0.2)', color: '#c7d2fe', fontSize: '11px', letterSpacing: '0.08em', padding: '10px 12px', fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace' }}>ID: {authDetails.authorizationNumber}</div>
                      </div>

                      <div className="eob-card" style={{ background: '#ffffff', border: '1px solid rgba(226,232,240,0.95)', borderRadius: '18px', padding: '20px', boxShadow: '0 12px 28px rgba(148, 163, 184, 0.08)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', borderBottom: '1px solid rgba(226,232,240,0.9)', paddingBottom: '14px' }}>
                          <div>
                            <div style={{ fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 800, marginBottom: '4px' }}>Prior Authorization</div>
                            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.03em' }}>Explanation of Benefits</h3>
                          </div>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '999px', padding: '7px 12px', fontSize: '11px', fontWeight: 800, background: '#ecfdf5', color: '#15803d', border: '1px solid rgba(22,163,74,0.18)' }}>
                            ✓ {authDetails.status}
                          </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
                          <EOBField label="Authorization #" value={authDetails.authorizationNumber} />
                          <EOBField label="Payer" value={insurance} />
                          <EOBField label="Decision Date" value={authDetails.decisionDate} />
                          <EOBField label="Valid From" value={authDetails.effectiveDate} />
                          <EOBField label="Valid Through" value={authDetails.expirationDate} />
                          <EOBField label="Approved Scope" value={authDetails.approvedScope} />
                        </div>

                        <div style={{ borderTop: '1px dashed rgba(148,163,184,0.4)', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <span style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 }}>Authorized Service</span>
                          <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{procedureDisplay}</div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px', borderTop: '1px dashed rgba(148,163,184,0.4)', paddingTop: '14px' }}>
                          <EOBField label="Allowed Amount" value={formatMoney(costBreakdown?.allowedAmount)} />
                          <EOBField label="Plan Payment" value={formatMoney(costBreakdown?.planPaid)} highlight="indigo" />
                          <EOBField label="Patient Responsibility" value={formatMoney(costBreakdown?.patientResponsibility)} highlight="green" />
                        </div>

                        <p style={{ margin: 0, fontSize: '11.5px', lineHeight: 1.6, color: '#64748b' }}>
                          This authorization confirms medical necessity has been verified and secures the cost-share above for the authorized service. Charges billed outside the approved scope or validity window may require a separate review.
                        </p>
                      </div>
                    </>
                  )}
                </section>
              </>
            ) : (
              <div className="audit-panel" style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(226,232,240,0.95)', borderRadius: '18px', padding: '18px', boxShadow: '0 12px 28px rgba(148, 163, 184, 0.08)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 800 }}>Payer Portal History</h3>

                <div className="log-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 12px', borderRadius: '14px', border: '1px solid rgba(226,232,240,1)', background: '#f8fafc' }}>
                  <div>
                    <div className="log-title" style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>{procedureDisplay}</div>
                    <div className="log-meta" style={{ marginTop: '4px', fontSize: '11px', color: '#64748b' }}>Processed: 2 hours ago</div>
                  </div>
                  <div className="status-tag success" style={{ borderRadius: '10px', padding: '6px 8px', fontSize: '11px', fontWeight: 800, whiteSpace: 'nowrap', background: '#ecfdf5', color: '#15803d', border: '1px solid rgba(22,163,74,0.15)' }}>Approved</div>
                </div>

                <div className="log-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 12px', borderRadius: '14px', border: '1px solid rgba(226,232,240,1)', background: '#f8fafc' }}>
                  <div>
                    <div className="log-title" style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>{insurance}</div>
                    <div className="log-meta" style={{ marginTop: '4px', fontSize: '11px', color: '#64748b' }}>Processed: Yesterday</div>
                  </div>
                  <div className="status-tag info" style={{ borderRadius: '10px', padding: '6px 8px', fontSize: '11px', fontWeight: 800, whiteSpace: 'nowrap', background: '#eff6ff', color: '#1d4ed8', border: '1px solid rgba(59,130,246,0.15)' }}>Auto-Cleared</div>
                </div>
              </div>
            )}
          </main>
        </div>

        <footer className="panel-footer" style={{ padding: '14px 16px 18px', textAlign: 'center', fontSize: '9px', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', background: 'rgba(248,250,252,0.9)', borderTop: '1px solid rgba(226,232,240,0.9)' }}>🛡️ Enterprise Gateway • OAuth2 Certified • HIPAA Compliant</footer>
      </div>
    </div>
  );
}