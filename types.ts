
export interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

export interface ConversationState {
  isActive: boolean;
  isConnecting: boolean;
  error: string | null;
}
