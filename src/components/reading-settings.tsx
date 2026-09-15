'use client';

import { useCallback, useState } from 'react';
import { Send, Loader2, BookUp, Copy, Check } from 'lucide-react';

interface ReadingSettingsProps {
  kindleEmail: string | null;
  kindleAutoSend: boolean;
  senderAddress: string;
  newsletterAddress: string | undefined;
}

export function ReadingSettings({
  kindleEmail: initial,
  kindleAutoSend: initialAutoSend,
  senderAddress,
  newsletterAddress,
}: ReadingSettingsProps) {
  const [kindleEmail, setKindleEmail] = useState(initial || '');
  const [kindleAutoSend, setKindleAutoSend] = useState(initialAutoSend);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string>('');
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const handleSaveEmail = useCallback(async () => {
    setSaving(true);
    setSaveStatus('');
    try {
      const res = await fetch('/api/settings/reading', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kindleEmail: kindleEmail.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json();
        setSaveStatus(data.error || 'Error saving email');
      } else {
        setSaveStatus('Saved');
        setTimeout(() => setSaveStatus(''), 3000);
      }
    } catch (e) {
      setSaveStatus('Network error');
    } finally {
      setSaving(false);
    }
  }, [kindleEmail]);

  const handleAutoSendChange = useCallback(async (checked: boolean) => {
    setKindleAutoSend(checked);
    try {
      await fetch('/api/settings/reading', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kindleAutoSend: checked }),
      });
    } catch (e) {
      console.error('Error saving auto-send setting', e);
    }
  }, []);

  const handleTest = useCallback(async () => {
    if (!kindleEmail.trim()) return;
    setTesting(true);
    setTestStatus('');
    try {
      const res = await fetch('/api/settings/reading/test', { method: 'POST' });
      if (res.ok) {
        setTestStatus('Test sent — check your Kindle in a minute');
        setTimeout(() => setTestStatus(''), 5000);
      } else {
        const data = await res.json();
        setTestStatus(data.error || 'Error sending test');
      }
    } catch (e) {
      setTestStatus('Network error');
    } finally {
      setTesting(false);
    }
  }, [kindleEmail]);

  const handleCopyNewsletter = useCallback(() => {
    if (newsletterAddress) {
      navigator.clipboard.writeText(newsletterAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [newsletterAddress]);

  return (
    <div className='space-y-4'>
      <div>
        <label className='block text-sm font-medium mb-2'>Kindle Email</label>
        <div className='flex gap-2'>
          <input
            type='email'
            placeholder='name@kindle.com'
            value={kindleEmail}
            onChange={(e) => setKindleEmail(e.target.value)}
            className='flex-1 px-3 py-2 border border-gray-300 rounded text-sm'
          />
          <button
            onClick={handleSaveEmail}
            disabled={saving}
            className='px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50'
          >
            Save
          </button>
        </div>
        {saveStatus && <p className='text-xs mt-1'>{saveStatus}</p>}
      </div>

      <div className='flex items-center gap-2'>
        <input
          type='checkbox'
          id='autoSend'
          checked={kindleAutoSend}
          onChange={(e) => handleAutoSendChange(e.target.checked)}
          className='rounded'
        />
        <label htmlFor='autoSend' className='text-sm'>
          Send new saves to Kindle automatically
        </label>
      </div>

      <button
        onClick={handleTest}
        disabled={!kindleEmail.trim() || testing}
        className='px-4 py-2 border border-gray-300 rounded text-sm disabled:opacity-50'
      >
        {testing ? <Loader2 className='w-4 h-4 inline animate-spin mr-2' /> : null}
        Send test
      </button>
      {testStatus && <p className='text-xs'>{testStatus}</p>}

      <div className='border-t pt-4 mt-4 space-y-3'>
        <div>
          <p className='text-xs font-medium mb-1'>Kindle sender approval</p>
          <p className='text-xs text-gray-600'>
            Amazon only accepts documents from approved senders. Add <strong>{senderAddress}</strong> in{' '}
            <a href='https://www.amazon.com/mycd' target='_blank' rel='noopener noreferrer' className='underline'>
              Amazon → Manage Your Content and Devices → Preferences → Personal Document Settings
            </a>
            .
          </p>
        </div>

        {newsletterAddress ? (
          <div>
            <p className='text-xs font-medium mb-1'>Newsletter address</p>
            <div className='flex items-center gap-2 p-2 bg-gray-100 rounded text-xs font-mono'>
              {newsletterAddress}
              <button onClick={handleCopyNewsletter} className='ml-auto'>
                {copied ? <Check className='w-4 h-4' /> : <Copy className='w-4 h-4' />}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p className='text-xs text-gray-500'>Newsletter address: Not set up yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
