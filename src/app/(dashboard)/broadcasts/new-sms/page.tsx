'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { Tag } from '@/types';
import { useSmsBroadcast, type SmsAudienceConfig } from '@/hooks/use-sms-broadcast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Loader2, MessageSquare, Users } from 'lucide-react';

const SMS_MAX_CHARS = 918; // 6 GSM-7 segments — a generous ceiling before per-recipient cost climbs a lot.

export default function NewSmsBroadcastPage() {
  const router = useRouter();
  const { createAndSendSmsBroadcast, isProcessing, progress } = useSmsBroadcast();

  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [audienceType, setAudienceType] = useState<SmsAudienceConfig['type']>('all');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);

  useEffect(() => {
    async function fetchTags() {
      setLoadingTags(true);
      try {
        const supabase = createClient();
        const { data } = await supabase.from('tags').select('*').order('name');
        setTags(data ?? []);
      } finally {
        setLoadingTags(false);
      }
    }
    fetchTags();
  }, []);

  function toggleTag(id: string) {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  const isValid =
    name.trim().length > 0 &&
    body.trim().length > 0 &&
    body.length <= SMS_MAX_CHARS &&
    (audienceType === 'all' || tagIds.length > 0);

  async function handleSend() {
    try {
      const id = await createAndSendSmsBroadcast({
        name: name.trim(),
        body: body.trim(),
        audience: { type: audienceType, tagIds: audienceType === 'tags' ? tagIds : undefined },
      });
      router.push(`/broadcasts/sms/${id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'SMS broadcast failed';
      toast.error(message);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={() => router.push('/broadcasts')} className="border-border">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <MessageSquare className="h-5 w-5 text-primary" />
            New SMS Broadcast
          </h1>
          <p className="text-sm text-muted-foreground">
            Plain-text bulk SMS via your connected SMS Gateway device — no template approval needed.
          </p>
        </div>
      </div>

      {isProcessing ? (
        <div className="space-y-3 rounded-xl border border-border bg-card/50 p-6 text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Sending… {progress}%</p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="sms-broadcast-name">Campaign name</Label>
            <Input
              id="sms-broadcast-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Weekend offer"
            />
          </div>

          <div className="rounded-xl border border-border bg-card/50 p-4">
            <p className="mb-3 text-sm font-medium text-foreground">Audience</p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={audienceType === 'all' ? 'default' : 'outline'}
                onClick={() => setAudienceType('all')}
                className={audienceType === 'all' ? 'bg-primary text-primary-foreground' : 'border-border'}
              >
                <Users className="h-3.5 w-3.5" />
                All contacts
              </Button>
              <Button
                type="button"
                size="sm"
                variant={audienceType === 'tags' ? 'default' : 'outline'}
                onClick={() => setAudienceType('tags')}
                className={audienceType === 'tags' ? 'bg-primary text-primary-foreground' : 'border-border'}
              >
                By tag
              </Button>
            </div>

            {audienceType === 'tags' && (
              <div className="mt-3">
                {loadingTags ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : tags.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No tags found.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => {
                      const selected = tagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => toggleTag(tag.id)}
                          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                            selected
                              ? 'border-primary/30 bg-primary/10 text-primary'
                              : 'border-border bg-muted text-muted-foreground hover:border-border'
                          }`}
                        >
                          <span className="mr-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="sms-broadcast-body">Message</Label>
            <Textarea
              id="sms-broadcast-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Hi {{name}}, ..."
              rows={5}
              className={body.length > SMS_MAX_CHARS ? 'border-red-500' : ''}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Use <code className="rounded bg-muted px-1">{'{{name}}'}</code> to insert the contact&apos;s name.</span>
              <span className={body.length > SMS_MAX_CHARS ? 'text-red-400' : ''}>
                {body.length} / {SMS_MAX_CHARS}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end border-t border-border pt-4">
            <Button
              onClick={handleSend}
              disabled={!isValid}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <MessageSquare className="h-4 w-4" />
              Send SMS Broadcast
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
