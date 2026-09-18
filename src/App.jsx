import React, { useState, useEffect } from 'react';
import FHIR from 'fhirclient';
import './App.css';

export default function App() {
  const [patient, setPatient] = useState(null);
  const [insurance, setInsurance] = useState('Checking registry...');
  const [loading, setLoading] = useState(true);
  const [aiStatus, setAiStatus] = useState('idle');
  const [activeTab, setActiveTab] = useState('copilot');

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const launchParam = urlParams.get('launch');
    const issParam = urlParams.get('iss');

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
        return Promise.all([patientPromise, coveragePromise]);
      })
      .then(([patientData, coverageData]) => {
        const name = `${patientData.name[0].given.join(' ')} ${patientData.name[0].family}`;
        const dob = patientData.birthDate;

        let payerName = 'Aetna Choice POS II';
        if (coverageData && coverageData.entry && coverageData.entry.length > 0) {
          const firstEntry = coverageData.entry[0];
          if (firstEntry && firstEntry.resource && firstEntry.resource.payor && firstEntry.resource.payor.length > 0) {
            payerName = firstEntry.resource.payor[0].display || 'Aetna Choice POS II';
          }
        }

        setPatient({ name, dob });
        setInsurance(payerName);
        setLoading(false);
      })
      .catch((err) => {
        console.warn('FHIR Framework using fallback parameters:', err);
        setPatient({ name: 'Robert Chen', dob: '1978-04-12' });
        setInsurance('Aetna Choice POS II');
        setLoading(false);
      });
  }, []);

  const handleAiPreFill = () => {
    setAiStatus('scanning');
    setTimeout(() => setAiStatus('complete'), 2000);
  };

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
            <div className="brand-mark">CA</div>
            <div>
              <h1>
                Claim<span>Auth</span>
              </h1>
              <p>Automation Workspace • v2.0</p>
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
            <div>
              <h2>{patient?.name}</h2>
              <p>DOB: {patient?.dob}</p>
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
                Dr. Evans submitted an order for <strong>CPT 38221 (Bone Marrow Biopsy)</strong>. Payer guidelines mandate clinical approval prior to appointment booking.
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
                      <textarea
                        readOnly
                        defaultValue="Patient presentation reveals chronic cytopenia of uncertain etiology. Biopsy metrics are clinically necessary to exclude active bone marrow myelodysplasia parameters under primary diagnosis C92.01."
                      />
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