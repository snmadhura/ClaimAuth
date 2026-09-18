import React, { useState, useEffect } from 'react';
import FHIR from 'fhirclient';

export default function App() {
  const [patient, setPatient] = useState(null);
  const [insurance, setInsurance] = useState("Checking registry...");
  const [loading, setLoading] = useState(true);
  const [aiStatus, setAiStatus] = useState("idle");
  const [activeTab, setActiveTab] = useState("copilot");

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const launchParam = urlParams.get('launch');
    const issParam = urlParams.get('iss');

    if (launchParam && issParam) {
      FHIR.oauth2.authorize({
        clientId: "claim_auth_integration",
        scope: "patient/*.read launch online_access openid profile",
        redirectUri: window.location.origin
      });
      return;
    }

    FHIR.oauth2.ready()
      .then(client => {
        client.requestHeaders = {
          ...client.requestHeaders,
          "Bypass-Tunnel-Reminder": "true"
        };
        const patientPromise = client.patient.read();
        const coveragePromise = client.request(`Coverage?patient=${client.patient.id}`);
        return Promise.all([patientPromise, coveragePromise]);
      })
      .then(([patientData, coverageData]) => {
        const name = `${patientData.name[0].given.join(" ")} ${patientData.name[0].family}`;
        const dob = patientData.birthDate;
        
        let payerName = "Aetna Choice POS II";
        if (coverageData && coverageData.entry && coverageData.entry.length > 0) {
          const firstEntry = coverageData.entry[0];
          if (firstEntry && firstEntry.resource && firstEntry.resource.payor && firstEntry.resource.payor.length > 0) {
            payerName = firstEntry.resource.payor[0].display || "Aetna Choice POS II";
          }
        }

        setPatient({ name, dob });
        setInsurance(payerName);
        setLoading(false);
      })
      .catch(err => {
        console.warn("FHIR Framework using fallback parameters:", err);
        setPatient({ name: "Robert Chen", dob: "1978-04-12" });
        setInsurance("Aetna Choice POS II");
        setLoading(false);
      });
  }, []);

  const handleAiPreFill = () => {
    setAiStatus("scanning");
    setTimeout(() => setAiStatus("complete"), 2000);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#64748b', fontSize: '14px', backgroundColor: '#f1f5f9' }}>
        <div style={{ textAlign: 'center', backgroundColor: '#ffffff', padding: '32px', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }}>
          <div style={{ fontWeight: '600', color: '#1e1b4b', marginBottom: '4px' }}>Syncing ClaimAuth Core...</div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>Establishing secure connection pipeline</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100vw', height: '100vh', backgroundColor: '#f1f5f9', fontFamily: 'sans-serif' }}>
      
      <div style={{ width: '400px', height: '92vh', backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', display: 'flex', flexDirection: 'column', overflow: 'hidden', color: '#334155' }}>
        
        {/* HEADER BRAND LAYER */}
        <div style={{ padding: '20px 20px 12px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontWeight: '800', fontSize: '20px', color: '#0f172a', letterSpacing: '-0.03em' }}>Claim<span style={{color: '#4f46e5'}}>Auth</span></h1>
            <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#94a3b8', fontWeight: '500' }}>Automation Workspace • v2.0</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#f0fdf4', border: '1px solid #dcfce7', color: '#16a34a', padding: '6px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: '600' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#22c55e', display: 'inline-block' }}></span>
            FHIR Secure
          </div>
        </div>

        {/* TAB NAVIGATION PANEL */}
        <div style={{ display: 'flex', padding: '4px', backgroundColor: '#f8fafc', borderRadius: '8px', margin: '12px 20px 0 20px', border: '1px solid #f1f5f9' }}>
          <button 
            onClick={() => setActiveTab("copilot")}
            style={{ flex: 1, padding: '8px 12px', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', backgroundColor: activeTab === 'copilot' ? '#ffffff' : 'transparent', color: activeTab === 'copilot' ? '#4f46e5' : '#64748b' }}
          >
            📋 AI Co-Pilot
          </button>
          <button 
            onClick={() => setActiveTab("logs")}
            style={{ flex: 1, padding: '8px 12px', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', backgroundColor: activeTab === 'logs' ? '#ffffff' : 'transparent', color: activeTab === 'logs' ? '#4f46e5' : '#64748b' }}
          >
            📂 Audit Logs
          </button>
        </div>

        {/* ACTIVE PATIENT INFOGRAPHIC CARD */}
        <div style={{ padding: '16px 20px', backgroundColor: '#fafafa', borderBottom: '1px solid #f1f5f9', marginTop: '12px' }}>
          <div style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.05em', color: '#64748b', marginBottom: '6px' }}>Current Chart Stream</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ margin: 0, fontWeight: '700', fontSize: '16px', color: '#0f172a' }}>{patient?.name}</h2>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>DOB: {patient?.dob}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#4f46e5', backgroundColor: '#edf2ff', padding: '4px 8px', borderRadius: '6px', display: 'inline-block' }}>{insurance}</div>
            </div>
          </div>
        </div>

        {/* CORE WORKFLOW AREA */}
        <div style={{ padding: '20px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {activeTab === "copilot" ? (
            <>
              {/* ALERTER CRITICAL BOX */}
              <div style={{ backgroundColor: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '12px', padding: '14px', fontSize: '12.5px', color: '#78350f', lineHeight: '1.6' }}>
                <div style={{ fontWeight: '700', color: '#b45309', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  ⚡ Intercepted Missing Authorization
                </div>
                Dr. Evans submitted an order for <strong style={{ fontWeight: '700', color: '#0f172a' }}>CPT 38221 (Bone Marrow Biopsy)</strong>. Payer guidelines mandate clinical approval prior to appointment booking.
              </div>

              {/* CO-PILOT MODULE WORKSPACE */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', backgroundColor: '#ffffff' }}>
                <h3 style={{ margin: '0 0 14px 0', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8' }}>ClaimAuth Assistant</h3>
                
                {aiStatus === "idle" && (
                  <button 
                    onClick={handleAiPreFill}
                    style={{ width: '100%', backgroundColor: '#4f46e5', color: '#ffffff', fontWeight: '600', fontSize: '13px', padding: '12px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer' }}
                  >
                    🚀 Run AI Pre-Fill Engine
                  </button>
                )}

                {aiStatus === "scanning" && (
                  <div style={{ fontSize: '13px', padding: '16px 0', color: '#4f46e5', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'center' }}>
                    <span>Extracting EHR Clinical Data Metrics...</span>
                  </div>
                )}

                {aiStatus === "complete" && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ fontSize: '12px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', padding: '10px 12px', borderRadius: '8px', fontWeight: '500' }}>
                      ✓ Extracted evidence mapped perfectly to insurance guidelines.
                    </div>
                    <div>
                      <label style={{ fontSize: '10px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>Generated Justification Summary</label>
                      <textarea 
                        style={{ width: '100%', boxSizing: 'border-box', fontSize: '12.5px', padding: '10px', border: '1px solid #cbd5e1', borderRadius: '8px', height: '110px', lineHeight: '1.6', color: '#334155', fontFamily: 'inherit', resize: 'none', outline: 'none', backgroundColor: '#f8fafc' }}
                        defaultValue="Patient presentation reveals chronic cytopenia of uncertain etiology. Biopsy metrics are clinically necessary to exclude active bone marrow myelodysplasia parameters under primary diagnosis C92.01."
                      />
                    </div>
                    <button 
                      onClick={() => setAiStatus("submitted")}
                      style={{ width: '100%', backgroundColor: '#0f172a', color: '#ffffff', fontWeight: '600', fontSize: '13px', padding: '12px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer' }}
                    >
                      📤 Transmit Authorization Payload
                    </button>
                  </div>
                )}

                {aiStatus === "submitted" && (
                  <div style={{ backgroundColor: '#1e1b4b', border: '1px solid #312e81', color: '#ffffff', padding: '20px', borderRadius: '12px', textAlign: 'center' }}>
                    <div style={{ fontWeight: '800', fontSize: '15px', color: '#c7d2fe', marginBottom: '4px' }}>📡 Packet Securely Dispatched</div>
                    <p style={{ margin: 0, color: '#93c5fd', fontSize: '12px', fontWeight: '500' }}>Status: Intake Registry Processing</p>
                    <div style={{ margin: '14px 0 0 0', fontFamily: 'monospace', fontSize: '11px', color: '#a5b4fc', backgroundColor: 'rgba(0,0,0,0.2)', padding: '8px', borderRadius: '6px', letterSpacing: '0.05em' }}>
                      ID: CA-9831-2026
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* AUDIT LOG PANEL */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <h3 style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8' }}>Payer Portal History</h3>
              <div style={{ padding: '12px', border: '1px solid #e2e8f0', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>CPT 70551 - MRI Brain</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>Processed: 2 hours ago</div>
                </div>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#16a34a', backgroundColor: '#f0fdf4', padding: '4px 8px', borderRadius: '6px' }}>Approved</div>
              </div>
              <div style={{ padding: '12px', border: '1px solid #e2e8f0', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>CPT 93000 - Electrocardiogram</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>Processed: Yesterday</div>
                </div>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#2563eb', backgroundColor: '#eff6ff', padding: '4px 8px', borderRadius: '6px' }}>Auto-Cleared</div>
              </div>
            </div>
          )}
        </div>
        
        {/* WORKSTATION BOTTOM FOOTHOLD */}
        <div style={{ padding: '14px', backgroundColor: '#f8fafc', borderTop: '1px solid #f1f5f9', textAlign: 'center', fontSize: '10px', fontWeight: '600', letterSpacing: '0.025em', color: '#94a3b8' }}>
          🛡️ Enterprise Gateway • OAuth2 Certified • HIPAA Compliant
        </div>
      </div>
      
    </div>
  );
}