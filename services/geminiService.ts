
import { GoogleGenAI, Modality, Type } from "@google/genai";

export const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY as string });

export const translateAndSpeak = async (text: string, fromLang: string, toLang: string) => {
  const ai = getAI();
  
  const translationResponse = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Translate this text from ${fromLang} to ${toLang}. Be natural and accurate. Output ONLY the translated text: "${text}"`,
  });

  const translatedText = translationResponse.text?.trim() || "Tarjima qilishda xatolik yuz berdi.";

  const speechResponse = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: translatedText }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' }, 
        },
      },
    },
  });

  const base64Audio = speechResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  return { translatedText, base64Audio };
};

export const speakText = async (text: string) => {
  const ai = getAI();
  try {
    const speechResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' }, 
          },
        },
      },
    });
    return speechResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  } catch (e) {
    console.error("TTS Error:", e);
    return null;
  }
};

export const discoverPlaces = async (query: string, lang: string) => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview", 
    contents: `Find 6 top famous tourist landmarks in ${query}. Provide details in ${lang} language. 
    Crucial for images: For each place, provide a VERY SPECIFIC visual keyword in English including the city and country (e.g. "Registan Samarkand Uzbekistan" or "Eiffel Tower Paris France"). 
    Also, generate exactly 5 related Google-style search questions (in ${lang}) that people usually ask about ${query}.`,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          places: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                description: { type: Type.STRING },
                location: { type: Type.STRING },
                rating: { type: Type.NUMBER },
                imgTag: { type: Type.STRING }
              },
              required: ["name", "description", "location", "rating", "imgTag"]
            }
          },
          relatedQueries: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ["places", "relatedQueries"]
      }
    }
  });

  try {
    const data = JSON.parse(response.text || '{"places":[], "relatedQueries":[]}');
    return {
      places: data.places.map((p: any) => ({
        ...p,
        mapLink: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ' ' + p.location)}`,
        // Aniqroq rasmlar uchun bir nechta manba kombinatsiyasi:
        imageUrl: `https://loremflickr.com/800/600/${encodeURIComponent(p.imgTag.replace(/\s+/g, ','))}`
      })),
      relatedQueries: data.relatedQueries || []
    };
  } catch (e) {
    console.error("Parsing failed", e);
    return { places: [], relatedQueries: [] };
  }
};

export const aiTravelAgent = async (userMessage: string, lang: string, history: any[]) => {
  const ai = getAI();
  const chat = ai.chats.create({
    model: 'gemini-3-pro-preview',
    config: {
      systemInstruction: `Siz dunyodagi eng aqlli va samimiy sayohat gidisiz. Foydalanuvchi bilan ${lang} tilida muloqot qiling. Google Search yordamida eng yangi ma'lumotlarni toping. Agar foydalanuvchi biror davlat (masalan O'zbekiston) haqida so'rasa, o'sha joyning diqqatga sazovor joylari, madaniyati va oshxonasi haqida batafsil ma'lumot bering.`,
      tools: [{ googleSearch: {} }]
    },
  });

  const response = await chat.sendMessage({ message: userMessage });
  return {
    text: response.text || "Kechirasiz, javob olishda muammo yuz berdi.",
    links: response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((c: any) => c.web?.uri).filter(Boolean) || []
  };
};

export const decodeBase64Audio = async (base64: string, ctx: AudioContext) => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const dataInt16 = new Int16Array(bytes.buffer);
  const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < dataInt16.length; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  return buffer;
};

export function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
