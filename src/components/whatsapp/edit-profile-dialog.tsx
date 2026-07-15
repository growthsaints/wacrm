'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Upload, User2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const VERTICALS: { value: string; label: string }[] = [
  { value: 'UNDEFINED', label: 'Not specified' },
  { value: 'AUTO', label: 'Automotive' },
  { value: 'BEAUTY', label: 'Beauty, spa, salon' },
  { value: 'APPAREL', label: 'Clothing & apparel' },
  { value: 'EDU', label: 'Education' },
  { value: 'ENTERTAIN', label: 'Entertainment' },
  { value: 'EVENT_PLAN', label: 'Event planning' },
  { value: 'FINANCE', label: 'Finance & banking' },
  { value: 'GROCERY', label: 'Grocery' },
  { value: 'GOVT', label: 'Government' },
  { value: 'HOTEL', label: 'Hotel & lodging' },
  { value: 'HEALTH', label: 'Health & medical' },
  { value: 'NONPROFIT', label: 'Non-profit' },
  { value: 'PROF_SERVICES', label: 'Professional services' },
  { value: 'RETAIL', label: 'Retail' },
  { value: 'TRAVEL', label: 'Travel & transport' },
  { value: 'RESTAURANT', label: 'Restaurant' },
  { value: 'OTHER', label: 'Other' },
];

interface BusinessProfile {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  profile_picture_url?: string;
  websites?: string[];
  vertical?: string;
}

export function EditProfileDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notConnected, setNotConnected] = useState(false);
  const [profile, setProfile] = useState<BusinessProfile>({});
  const [website, setWebsite] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setNotConnected(false);
    fetch('/api/whatsapp/business-profile')
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data?.code === 'not_connected') setNotConnected(true);
          else toast.error(data?.error || 'Could not load your business profile.');
          return;
        }
        setProfile(data.profile ?? {});
        setWebsite(data.profile?.websites?.[0] ?? '');
      })
      .catch(() => toast.error('Could not load your business profile.'))
      .finally(() => setLoading(false));
  }, [open]);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Photo must be under 5 MB.');
      return;
    }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const form = new FormData();
      form.set('about', profile.about ?? '');
      form.set('description', profile.description ?? '');
      form.set('address', profile.address ?? '');
      form.set('email', profile.email ?? '');
      form.set('vertical', profile.vertical ?? 'UNDEFINED');
      form.set('websites', JSON.stringify(website.trim() ? [website.trim()] : []));
      if (photoFile) form.set('photo', photoFile);

      const res = await fetch('/api/whatsapp/business-profile', {
        method: 'POST',
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || 'Could not save your business profile.');
        return;
      }
      toast.success('Business profile updated.');
      onSaved?.();
      onOpenChange(false);
    } catch {
      toast.error('Could not save your business profile.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Setup Your Profile</DialogTitle>
          <DialogDescription>
            This is what your customers see when they open a chat with you on WhatsApp.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : notConnected ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Connect your WhatsApp number first, then come back to set up your profile.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted"
              >
                {photoPreview || profile.profile_picture_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoPreview || profile.profile_picture_url}
                    alt="Business profile"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <User2 className="h-6 w-6 text-muted-foreground" />
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <Upload className="h-4 w-4 text-white" />
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={handlePhotoChange}
              />
              <p className="text-xs text-muted-foreground">
                Click the circle to upload a profile photo (JPEG/PNG, under 5 MB).
              </p>
            </div>

            <div>
              <Label className="mb-1.5 block">About</Label>
              <Input
                value={profile.about ?? ''}
                onChange={(e) => setProfile((p) => ({ ...p, about: e.target.value }))}
                placeholder="A short line customers see near your name"
                maxLength={139}
              />
            </div>

            <div>
              <Label className="mb-1.5 block">Description</Label>
              <Textarea
                value={profile.description ?? ''}
                onChange={(e) => setProfile((p) => ({ ...p, description: e.target.value }))}
                placeholder="What your business does"
                rows={3}
              />
            </div>

            <div>
              <Label className="mb-1.5 block">Category</Label>
              <Select
                value={profile.vertical ?? 'UNDEFINED'}
                onValueChange={(v) => setProfile((p) => ({ ...p, vertical: v ?? 'UNDEFINED' }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VERTICALS.map((v) => (
                    <SelectItem key={v.value} value={v.value}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="mb-1.5 block">Address</Label>
              <Input
                value={profile.address ?? ''}
                onChange={(e) => setProfile((p) => ({ ...p, address: e.target.value }))}
                placeholder="Business address"
              />
            </div>

            <div>
              <Label className="mb-1.5 block">Email</Label>
              <Input
                type="email"
                value={profile.email ?? ''}
                onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                placeholder="support@yourbusiness.com"
              />
            </div>

            <div>
              <Label className="mb-1.5 block">Website</Label>
              <Input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://yourbusiness.com"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          {!loading && !notConnected && (
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
