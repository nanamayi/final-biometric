import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey: string = import.meta.env.VITE_SUPABASE_ANON_KEY;


const isConfigured: boolean = Boolean(
  supabaseUrl &&
  supabaseUrl.startsWith('https://') &&
  supabaseAnonKey &&
  supabaseAnonKey.length > 50
);


const mockMethod = (message: string) => () =>
  Promise.resolve({
    data: null,
    error: { message }
  });


const mockClient: SupabaseClient = {
  from: () => ({
    select: mockMethod('Supabase URL/Key missing.'),
    insert: mockMethod('Supabase URL/Key missing.'),
    delete: mockMethod('Supabase URL/Key missing.'),
    update: () => ({
      eq: mockMethod('Supabase URL/Key missing.')
    })
  })
} as unknown as SupabaseClient;


export const supabase: SupabaseClient = isConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : mockClient;

export const SUPABASE_CONFIGURED: boolean = isConfigured;