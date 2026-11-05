import { api } from "../config/api";

export interface Photographer {
  id: number;
  name: string;
  portfolio_url: string;
  default_role: string | null;
  gallery_count?: number;
}

export interface EventCredit {
  photographer_id: number;
  name: string;
  portfolio_url: string;
  role: string | null;
}

export interface PhotographerInput {
  name: string;
  portfolio_url: string;
  default_role?: string | null;
}

export const photographersService = {
  async list(): Promise<Photographer[]> {
    const response = await api.get<{ photographers: Photographer[] }>("/admin/photographers");
    return response.data.photographers;
  },

  async create(input: PhotographerInput): Promise<Photographer> {
    const response = await api.post<{ photographer: Photographer }>("/admin/photographers", input);
    return response.data.photographer;
  },

  async update(id: number, input: PhotographerInput): Promise<Photographer> {
    const response = await api.put<{ photographer: Photographer }>(`/admin/photographers/${id}`, input);
    return response.data.photographer;
  },

  async remove(id: number): Promise<void> {
    await api.delete(`/admin/photographers/${id}`);
  },

  async getEventCredits(eventId: number): Promise<EventCredit[]> {
    const response = await api.get<{ credits: EventCredit[] }>(`/admin/photographers/events/${eventId}`);
    return response.data.credits;
  },

  async saveEventCredits(eventId: number, credits: Array<{ photographer_id: number; role: string | null }>): Promise<EventCredit[]> {
    const response = await api.put<{ credits: EventCredit[] }>(`/admin/photographers/events/${eventId}`, { credits });
    return response.data.credits;
  },
};
