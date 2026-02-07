
import { createClient } from '@supabase/supabase-js';

// Use the credentials provided by the user. 
// We use these as defaults if environment variables are not present.
const supabaseUrl = process.env.SUPABASE_URL || 'https://rtykbpztwbtsuqefdlst.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0eWticHp0d2J0c3VxZWZkbHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMDAwNDgsImV4cCI6MjA4NTY3NjA0OH0.sEP4dfB3P8E4SiW7rVLI7d3RxG1s0PD5VddKHiyw2b4';

// Check if we have valid-looking strings
const isConfigured = Boolean(
  supabaseUrl && 
  supabaseUrl.startsWith('https://') && 
  supabaseAnonKey && 
  supabaseAnonKey.length > 50
);

export const supabase = isConfigured 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : {
      from: () => ({
        select: () => ({ 
          order: () => Promise.resolve({ data: [], error: { message: 'Supabase URL/Key missing. Check project environment.' } }),
          single: () => Promise.resolve({ data: null, error: { message: 'Supabase URL/Key missing.' } })
        }),
        insert: () => Promise.resolve({ error: { message: 'Supabase URL/Key missing.' } }),
        update: () => ({ eq: () => Promise.resolve({ error: { message: 'Supabase URL/Key missing.' } }) }),
      })
    } as any;

export const SUPABASE_CONFIGURED = isConfigured;
