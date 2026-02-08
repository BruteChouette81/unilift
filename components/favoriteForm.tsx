import { geoSuggestion } from "@/services/rideServices";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

export type FavoriteRoute = {
  id?: number;
 
  
  endGeolocation?: { lat: number; lon: number };
  endAddress: string;
  
};

type Props = {
  /** If provided, the form will load in "edit" mode */
  initialData?: FavoriteRoute;

  /** Called when form is submitted */
  onSubmit: (route: FavoriteRoute) => void;

  /** Optional: called when user cancels */
  onCancel?: () => void;

  onDelete: (id:number) => void
};

export default function FavoriteRouteForm({
  initialData,
  onSubmit,
  onCancel,
  onDelete
}: Props) {
 
 
  const [endAddress, setEndAddress] = useState(initialData?.endAddress ?? "");
  const [endGeolocation, setEndGeolocation] = useState<{ lat: number; lon: number } | undefined>(initialData?.endGeolocation);

  
    
  const [endSuggestions, setEndSuggestions] = useState<any[]>([]);
  const [showEndSuggestions, setShowEndSuggestions] = useState(false);
 

  const [errors, setErrors] = useState<{ [key: string]: string }>({});


 

  const onEndAddressChange = async (text: string) => {
    setEndAddress(text);
   
  }
    const onSelectSuggestionEndAddress = (value: any) => {
  setEndAddress(value.displayName);
  setEndGeolocation({ lat: parseFloat(value.lat), lon: parseFloat(value.lon) });
  setShowEndSuggestions(false);
}

  // Simple validation
  const validate = () => {
    const e: { [key: string]: string } = {};

    
   
    if (!endAddress.trim()) e.endAddress = "End address is required";
    

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  useEffect(() => {
    
    const timeout = setTimeout(async () => {
       if (endAddress.length < 2) {
        setShowEndSuggestions(false);
        //setSuggestions([]); 
      } else {

      //setLoading(true);
      const results = await geoSuggestion(endAddress
      );
      //console.log(results)
      setEndSuggestions(results);
      setShowEndSuggestions(true);
      }
      //setLoading(false);
    }, 1000); // debounce

    return () => clearTimeout(timeout);
    
    
  }, [endAddress]);



  const handleSubmit = () => {
    if (!validate()) return;

    const payload: FavoriteRoute = {
      id: initialData?.id, // only keep ID if editing
      
      endGeolocation,
      endAddress,
      
    };

    console.log("Submitting favorite route:", payload);

    onSubmit(payload);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {initialData ? "Edit Favorite Route" : "Create Favorite Route"}
      </Text>

      
      {/* End Address */}
      <TextInput
        style={[styles.input, errors.endAddress && styles.errorInput]}
        placeholder="Destination"
        value={endAddress}
        onChangeText={onEndAddressChange}
      />
      {showEndSuggestions && endSuggestions.length > 0 && (
          <View style={styles.suggestionsContainer}>
            {endSuggestions.map((item, index) => (
              <TouchableOpacity
                key={index}
                onPress={() => onSelectSuggestionEndAddress(item)}
                style={styles.suggestionItem}
              >
                <Text style={{color:"white"}}>{item?.displayName}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      {errors.endAddress && (
        <Text style={styles.errorText}>{errors.endAddress}</Text>
      )}

      

      {/* Buttons */}
      <View style={styles.buttonRow}>
        <Pressable style={styles.submitButton} onPress={handleSubmit}>
          <Text style={styles.btnText}>
            {initialData ? "Save" : "Create"}
          </Text>
        </Pressable>

        {onCancel && (
          <Pressable style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.btnText}>Cancel</Text>
          </Pressable>
        )}


{initialData?.id !== undefined &&
          <Pressable style={styles.deleteButton} onPress={() => {onDelete(initialData.id)}}>
            <Text style={styles.btnText}>Delete</Text>
          </Pressable>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 15,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    fontSize: 16,
    color: "white"
  },
  errorInput: {
    borderColor: "red",
  },
  errorText: {
    color: "red",
    marginBottom: 8,
    marginLeft: 4,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  submitButton: {
    backgroundColor: "#3B82F6",
    padding: 12,
    borderRadius: 10,
    flex: 1,
    alignItems: "center",
  },
  cancelButton: {
    backgroundColor: "gray",
    padding: 12,
    borderRadius: 10,
    flex: 1,
    alignItems: "center",
  },
  deleteButton: {
    backgroundColor: "#EF4444",
    padding: 12,
    borderRadius: 10,
    flex: 1,
    alignItems: "center",
  },
  btnText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
  },
   suggestionsContainer: {
  backgroundColor: "#222",
  borderRadius: 8,
  marginTop: 0,
  paddingVertical: 4,
  marginBottom: 16,
},

suggestionItem: {
  padding: 12,
  borderBottomWidth: 1,
  borderBottomColor: "rgba(255,255,255,0.1)",
},
});
