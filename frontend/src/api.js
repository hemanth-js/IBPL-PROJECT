import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

export const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

export const endpoints = {
  donors: '/api/donors',
  donorStatus: (id) => `/api/donors/${id}/status`,
  requests: '/api/requests',
  requestDelete: (id) => `/api/requests/${id}`,
  requestRespond: (id) => `/api/requests/${id}/respond`,
  match: '/api/match',
  health: '/health',
};

