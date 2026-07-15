import { useStripe } from "@stripe/stripe-react-native";
import { useEffect, useState } from "react";

import { Text, TouchableOpacity, View } from "react-native";

import { apiBaseUrl, apiFetch } from "@/constants/runtime-config";

//https://docs.stripe.com/payments/accept-a-payment?platform=react-native&ui=payment-sheet&lang=node
export default function CheckoutScreen() {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [loading, setLoading] = useState(false);

  const fetchPaymentSheetParams = async () => {
    const response = await apiFetch(`${apiBaseUrl}/payment-sheet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    const { paymentIntent, ephemeralKey, customer } = await response.json();

    return {
      paymentIntent,
      ephemeralKey,
      customer,
    };
  };

  const initializePaymentSheet = async () => {
    const {
      paymentIntent,
      ephemeralKey,
      customer,
    } = await fetchPaymentSheetParams();

    const { error } = await initPaymentSheet({
      merchantDisplayName: "Example, Inc.",
      customerId: customer,
      customerEphemeralKeySecret: ephemeralKey,
      paymentIntentClientSecret: paymentIntent,
      // Set `allowsDelayedPaymentMethods` to true if your business can handle payment
      //methods that complete payment after a delay, like SEPA Debit and Sofort.
      allowsDelayedPaymentMethods: true,
      defaultBillingDetails: {
        name: 'Jane Doe',
      }
    });
    if (!error) {
      setLoading(true);
    }
  };

  const openPaymentSheet = async () => {
    // see below
  };

  useEffect(() => {
    initializePaymentSheet();
  }, []);

  return (
    <View>
      <TouchableOpacity
       
        onPress={openPaymentSheet}
      > <Text>Pay</Text> </TouchableOpacity>
    </View>
  );
}