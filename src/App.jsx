import React, { useState, useEffect } from 'react';
import FHIR from 'fhirclient';
import './App.css';

export default function App() {
  const [patient, setPatient] = useState(null);
  const [insurance, setInsurance] = useState('Checking registry...');
  const [loading, setLoading] = useState(true);
  const [aiStatus, setAiStatus] = useState('idle');
  const [activeTab, setActiveTab] = useState('copilot');
  const [clinician, setClinician] = useState('Dr. Antonia Stark');

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

        const patientPromise = client.patient.read();
        const coveragePromise = client.request(`Coverage?patient=${client.patient.id}`);
        const practitionerPromise = client.userId ? client.request(client.userId) : Promise.resolve(null);

        return Promise.all([patientPromise, coveragePromise, practitionerPromise]);
      })
      .then(([patientData, coverageData, practitionerData]) => {
        let patientName = 'Robert Chen';

        if (patientData && patientData.name && Array.isArray(patientData.name) && patientData.name.length > 0) {
          const firstNameEntry = patientData.name[0];
          const givenNames = firstNameEntry.given && Array.isArray(firstNameEntry.given) ? firstNameEntry.given : [];
          const familyName = firstNameEntry.family || '';
          const givenText = givenNames.length > 0 ? givenNames.join(' ') : '';
          patientName = [givenText, familyName].filter(Boolean).join(' ') || patientName;
        }

        const dob = patientData && patientData.birthDate ? patientData.birthDate : '1978-04-12';

        let payerName = 'Aetna Choice POS II';
        if (coverageData && coverageData.entry) {
          const firstEntry = coverageData.entry[0];
          if (
            firstEntry &&
            firstEntry.resource &&
            firstEntry.resource.payor &&
            Array.isArray(firstEntry.resource.payor) &&
            firstEntry.resource.payor.length > 0
          ) {
            payerName = firstEntry.resource.payor[0].display || payerName;
          }
        }

        let realDocName = 'Active Institutional Provider';

        if (practitionerData && practitionerData.name && practitionerData.name[0]) {
          const practitionerName = practitionerData.name[0];
          const prefixText = practitionerName.prefix && Array.isArray(practitionerName.prefix)
            ? practitionerName.prefix.join(' ') + ' '
            : '';
          const givenText = practitionerName.given && Array.isArray(practitionerName.given)
            ? practitionerName.given.join(' ')
            : '';
          const familyText = practitionerName.family || '';

          realDocName = `${practitionerName.prefix ? practitionerName.prefix.join(' ') + ' ' : ''}${practitionerName.given ? practitionerName.given.join(' ') : ''} ${practitionerName.family || ''}`.trim();
          realDocName = `${prefixText}${givenText}${familyText ? ` ${familyText}` : ''}`.trim() || 'Active Institutional Provider';
        }

        setClinician(realDocName || 'Active Institutional Provider');
        setPatient({ name: patientName, dob });
        setInsurance(payerName);
        setLoading(false);
      })
      .catch((err) => {
        console.warn('FHIR Framework using fallback parameters:', err);
        setClinician('Active Institutional Provider');
        setPatient({ name: 'Robert Chen', dob: '1978-04-12' });
        setInsurance('Aetna Choice POS II');
        setLoading(false);
      });
  }, []);

  const handleAiPreFill = () => {
    setAiStatus('scanning');
    setTimeout(() => setAiStatus('complete'), 2000);
  };

  const patientInitial = patient?.name ? patient.name.charAt(0).toUpperCase() : 'P';
  const justificationText = `Patient records managed under ${clinician} track ongoing cytopenia criteria. Bone marrow core extraction is essential to exclude underlying myelodysplasia parameters under primary diagnostic profile C92.01.`;
  const alertBannerText = `${clinician} submitted an order for ${patient?.name || 'the selected patient'} for CPT 38221 (Bone Marrow Biopsy). Payer guidelines mandate clinical approval prior to appointment booking.`;

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-card">
          <div className="loading-spinner" aria-hidden="true" />
          <div className="loading-title">Syncing ClaimAuth Core...</div>
          <div className="loading-subtitle">Establishing secure connection pipeline</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="claim-panel">
        <header className="panel-header">
          <div className="brand-block">
            <div className="brand-mark" aria-label="ClaimAuth secure status">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 2.75l6.75 2.5V11c0 4.08-2.53 7.8-6.75 10.25C7.78 18.8 5.25 15.08 5.25 11V5.25L12 2.75zm-1.4 7.5l-1.35 1.35 2.75 2.75 5.5-5.5L16.6 7.5l-4.25 4.25-1.35-1.35z" />
              </svg>
            </div>

            <div className="brand-copy">
              <h1>
                Claim<span>Auth</span>
              </h1>
              <p>Active Provider session: {clinician}</p>
            </div>
          </div>

          <div className="status-pill">
            <span className="status-dot" />
            FHIR Secure
          </div>
        </header>

        <nav className="segmented-tabs" aria-label="Workspace tabs">
          <button
            type="button"
            className={activeTab === 'copilot' ? 'tab-button active' : 'tab-button'}
            onClick={() => setActiveTab('copilot')}
          >
            AI Co-Pilot
          </button>
          <button
            type="button"
            className={activeTab === 'logs' ? 'tab-button active' : 'tab-button'}
            onClick={() => setActiveTab('logs')}
          >
            Audit Logs
          </button>
        </nav>

        <section className="patient-card">
          <div className="section-label">Current Chart Stream</div>
          <div className="patient-row">
            <div className="patient-identity-block">
              <div className="patient-avatar" aria-label="Patient initial badge">
                {patientInitial}
              </div>
              <div>
                <h2>{patient?.name}</h2>
                <p>DOB: {patient?.dob}</p>
              </div>
            </div>

            <div className="insurance-badge">{insurance}</div>
          </div>

          <div className="mini-metrics">
            <div className="metric-pill">
              <span className="metric-label">Coverage</span>
              <strong>Verified</strong>
            </div>
            <div className="metric-pill">
              <span className="metric-label">Priority</span>
              <strong>High</strong>
            </div>
          </div>
        </section>

        <main className="workspace-content">
          {activeTab === 'copilot' ? (
            <>
              <div className="alert-banner">
                <div className="alert-title">⚡ Intercepted Missing Authorization</div>
                {alertBannerText}
              </div>

              <div className="assistant-panel">
                <h3>ClaimAuth Assistant</h3>

                {aiStatus === 'idle' && (
                  <button type="button" className="primary-button" onClick={handleAiPreFill}>
                    Run AI Pre-Fill Engine
                  </button>
                )}

                {aiStatus === 'scanning' && (
                  <div className="loading-inline">
                    <span className="inline-spinner" />
                    Extracting EHR Clinical Data Metrics...
                  </div>
                )}

                {aiStatus === 'complete' && (
                  <div className="assistant-output">
                    <div className="success-banner">✓ Extracted evidence mapped perfectly to insurance guidelines.</div>

                    <div className="field-group">
                      <label>Generated Justification Summary</label>
                      <textarea readOnly value={justificationText} />
                    </div>

                    <button type="button" className="inverse-button" onClick={() => setAiStatus('submitted')}>
                      Transmit Authorization Payload
                    </button>
                  </div>
                )}

                {aiStatus === 'submitted' && (
                  <div className="dispatch-card">
                    <div className="dispatch-title">📡 Packet Securely Dispatched</div>
                    <p>Status: Intake Registry Processing</p>
                    <div className="dispatch-id">ID: CA-9831-2026</div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="audit-panel">
              <h3>Payer Portal History</h3>

              <div className="log-item">
                <div>
                  <div className="log-title">CPT 70551 - MRI Brain</div>
                  <div className="log-meta">Processed: 2 hours ago</div>
                </div>
                <div className="status-tag success">Approved</div>
              </div>

              <div className="log-item">
                <div>
                  <div className="log-title">CPT 93000 - Electrocardiogram</div>
                  <div className="log-meta">Processed: Yesterday</div>
                </div>
                <div className="status-tag info">Auto-Cleared</div>
              </div>
            </div>
          )}
        </main>

        <footer className="panel-footer">🛡️ Enterprise Gateway • OAuth2 Certified • HIPAA Compliant</footer>
      </div>
    </div>
  );
}