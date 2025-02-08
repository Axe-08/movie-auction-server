// src/types.ts
import { Request, Response } from 'express';

export interface ConnectedClient {
    productionHouseId?: number;
    connectionTime: Date;
    lastActivity: Date;
}

export interface ProductionHouse {
    id: number;
    name: string;
    budget?: number;
    access_code?: string;
}

export interface CrewMember {
    id: number;
    name: string;
    status: string;
    category: string;
    rating: number;
    base_price: number;
    current_bid?: number;
}

export interface DatabaseError {
    message: string;
}

export interface TypedRequest<T> extends Request {
    body: T
}
