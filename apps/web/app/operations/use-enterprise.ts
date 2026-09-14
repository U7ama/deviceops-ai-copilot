 'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import type { FeatureState } from './enterprise-panel';
export function useEnterprise(enabled:boolean){
 const [data,setData]=useState<FeatureState|null>(null),[error,setError]=useState(''),[query,setQuery]=useState('');
 const request=useRef<AbortController|null>(null),search=useRef('');
 const refresh=useCallback(async()=>{request.current?.abort();const controller=new AbortController();request.current=controller;try{const r=await fetch(`/api/v2/enterprise?q=${encodeURIComponent(search.current)}`,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])});if(!r.ok)throw Error('Advanced operations data unavailable. Retry to refresh.');const body=await r.json();if(!controller.signal.aborted){setData(body);setError('');}}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Refresh failed');}},[]);
 useEffect(()=>{if(!enabled){request.current?.abort();setData(null);return;}let timer:ReturnType<typeof setTimeout>;let stopped=false;async function poll(){if(stopped||document.hidden)return;await refresh();if(!stopped)timer=setTimeout(poll,4000);}const visible=()=>{clearTimeout(timer);if(!document.hidden)void poll();};void poll();document.addEventListener('visibilitychange',visible);return()=>{stopped=true;clearTimeout(timer);request.current?.abort();document.removeEventListener('visibilitychange',visible);};},[enabled,refresh]);
 useEffect(()=>{const timer=setTimeout(()=>{search.current=query;if(enabled)void refresh();},300);return()=>clearTimeout(timer);},[query,enabled,refresh]);
 return {data,error,query,setQuery,refresh};
}
